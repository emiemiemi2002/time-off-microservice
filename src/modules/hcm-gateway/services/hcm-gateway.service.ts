import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HcmMockClient } from '../mocks/hcm-mock.client';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../../time-off/entities/time-off-request.entity';
import {
  BalanceLedgerEntry,
  LedgerTransactionType,
} from '../../ledger/entities/balance-ledger-entry.entity';

@Injectable()
export class HcmGatewayService {
  private readonly logger = new Logger(HcmGatewayService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly hcmClient: HcmMockClient,
  ) {}

  /**
   * Orchestrates the synchronization of a local request with the external HCM.
   * Applies the Anti-Corruption Layer pattern to map external responses to local state.
   * * @param requestId - The UUID of the local TimeOffRequest
   */
  async processSync(requestId: string): Promise<void> {
    // 1. Fetch the request outside the main transaction to avoid long-lived database locks
    // while we wait for the external network call.
    const requestRepo = this.dataSource.getRepository(TimeOffRequest);
    const request = await requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException(`Request with ID ${requestId} not found.`);
    }

    // Only sync if the request is pending sync
    if (request.status !== TimeOffStatus.APPROVED_LOCALLY) {
      this.logger.warn(
        `Request ${requestId} is not in a syncable state. Status: ${request.status}`,
      );
      return;
    }

    // 2. Mark as SYNCING
    await requestRepo.update(requestId, { status: TimeOffStatus.SYNCING });

    // 3. Make the external network call
    const hcmResponse = await this.hcmClient.syncTimeOffRequest(
      request.employeeId,
      request.locationId,
      request.amount,
    );

    // 4. Handle the response within a strict database transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (hcmResponse.success) {
        // Success Path: Mark request as COMPLETED and record the CONSUMPTION in the Ledger
        await queryRunner.manager.update(TimeOffRequest, requestId, {
          status: TimeOffStatus.COMPLETED,
        });

        const ledgerEntry = new BalanceLedgerEntry();
        ledgerEntry.employeeId = request.employeeId;
        ledgerEntry.locationId = request.locationId;
        ledgerEntry.type = LedgerTransactionType.CONSUMPTION;
        // Ensure deduction is negative
        ledgerEntry.amount = -Math.abs(request.amount);
        ledgerEntry.referenceId = request.id;

        await queryRunner.manager.save(ledgerEntry);

        this.logger.log(
          `Request ${requestId} successfully synced and Ledger updated.`,
        );
      } else if (hcmResponse.reason === 'REJECTED') {
        // Explicit Rejection Path: Mark as REJECTED.
        // No Ledger entry is made. The funds are automatically "released"
        // because our LedgerService ignores REJECTED statuses in pending calculations.
        await queryRunner.manager.update(TimeOffRequest, requestId, {
          status: TimeOffStatus.REJECTED,
        });

        this.logger.log(
          `Request ${requestId} explicitly rejected by HCM. Funds released.`,
        );
      } else {
        // Timeout/Error Path (The "Dual-Brain" mitigation):
        // Mark as FAILED_HCM. Funds remain locked in the pending calculation
        // until an administrator manually reconciles the state, preventing double-spending.
        await queryRunner.manager.update(TimeOffRequest, requestId, {
          status: TimeOffStatus.FAILED_HCM,
        });

        this.logger.warn(
          `Request ${requestId} failed to sync due to network issue. Manual reconciliation required.`,
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Database transaction failed during HCM sync for request ${requestId}`,
        error,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
