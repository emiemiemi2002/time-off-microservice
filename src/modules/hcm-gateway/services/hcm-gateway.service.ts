import { In } from 'typeorm';
import { LedgerService } from '../../ledger/services/ledger.service';
import { BatchSyncDto } from '../dto/batch-sync.dto';
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
    private readonly ledgerService: LedgerService,
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

  /**
   * Processes a batch payload from the HCM, reconciling local ledger state
   * with the external Source of Truth.
   * * @param dto - The batch of employee balances
   * @returns A summary of the actions taken
   */
  async processBatchSync(dto: BatchSyncDto): Promise<{
    processed: number;
    adjustments: number;
    cancellations: number;
  }> {
    let adjustments = 0;
    let cancellations = 0;
    const requestRepo = this.dataSource.getRepository(TimeOffRequest);

    for (const record of dto.balances) {
      // 1. Get our local absolute truth
      const localAbsoluteBalance = await this.ledgerService.getAbsoluteBalance(
        record.employeeId,
        record.locationId,
      );

      // 2. Calculate the difference
      const diff = record.balance - localAbsoluteBalance;

      if (diff !== 0) {
        // The HCM balance changed independently (e.g., work anniversary or HR manual edit).
        // We inject an adjustment transaction into the ledger to forcefully align the sums.
        await this.ledgerService.recordTransaction(
          record.employeeId,
          record.locationId,
          LedgerTransactionType.HCM_ADJUSTMENT,
          diff,
          'BATCH-SYNC-WEBHOOK',
        );
        adjustments++;
        this.logger.log(
          `Adjusted ledger for Emp: ${record.employeeId} by ${diff} days.`,
        );

        // 3. Prevent Negative Overdrafts (Self-Healing)
        // If the balance was externally REDUCED, we must check if the employee
        // now has negative available balance due to in-flight requests.
        let newAvailableBalance = await this.ledgerService.getAvailableBalance(
          record.employeeId,
          record.locationId,
        );

        if (newAvailableBalance < 0) {
          this.logger.warn(
            `Emp ${record.employeeId} is over-drafted by ${newAvailableBalance}. Reconciling pending requests...`,
          );

          // Fetch all locked requests, ordered by newest first
          const pendingRequests = await requestRepo.find({
            where: {
              employeeId: record.employeeId,
              locationId: record.locationId,
              status: In([
                TimeOffStatus.PENDING,
                TimeOffStatus.APPROVED_LOCALLY,
                TimeOffStatus.SYNCING,
                TimeOffStatus.FAILED_HCM,
              ]),
            },
            order: { createdAt: 'DESC' }, // Cancel the most recently submitted requests first
          });

          // Cancel requests one by one until the available balance is no longer negative
          for (const req of pendingRequests) {
            if (newAvailableBalance >= 0) break; // Balance restored, stop canceling

            await requestRepo.update(req.id, {
              status: TimeOffStatus.REJECTED,
            });
            cancellations++;
            newAvailableBalance += req.amount; // Recover the soft-locked funds

            this.logger.warn(
              `SYSTEM CANCELLED request [${req.id}] due to insufficient HCM balance.`,
            );
          }
        }
      }
    }

    return { processed: dto.balances.length, adjustments, cancellations };
  }
}
