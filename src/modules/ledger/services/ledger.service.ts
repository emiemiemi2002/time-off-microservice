import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BalanceLedgerEntry,
  LedgerTransactionType,
} from '../entities/balance-ledger-entry.entity';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../../time-off/entities/time-off-request.entity';

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @InjectRepository(BalanceLedgerEntry)
    private readonly ledgerRepo: Repository<BalanceLedgerEntry>,
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
  ) {}

  /**
   * Calculates the true available balance for an employee.
   * To prevent the "Dual-Brain" problem, it queries the absolute source of truth
   * (the ledger) and subtracts any locked/pending funds.
   * * @param employeeId - The ID of the employee
   * @param locationId - The location dimension
   * @returns The currently available balance (can be fractional)
   */
  async getAvailableBalance(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    // Define the expected return types for the raw queries
    interface LedgerSumResult {
      totalBalance: string | null;
    }

    interface PendingSumResult {
      totalPending: string | null;
    }

    // 1. Calculate the base balance from the ledger history
    // We cast the generic return type of getRawOne to our specific interface
    const ledgerQuery = await this.ledgerRepo
      .createQueryBuilder('ledger')
      .select('SUM(ledger.amount)', 'totalBalance')
      .where('ledger.employeeId = :employeeId', { employeeId })
      .andWhere('ledger.locationId = :locationId', { locationId })
      .getRawOne<LedgerSumResult>();

    // Safely parse the string to a float, defaulting to '0' if it is null/undefined
    const baseBalance = parseFloat(ledgerQuery?.totalBalance ?? '0');

    // 2. Calculate in-flight (pending) requests that haven't been deducted from the ledger yet
    const pendingRequestsQuery = await this.requestRepo
      .createQueryBuilder('request')
      .select('SUM(request.amount)', 'totalPending')
      .where('request.employeeId = :employeeId', { employeeId })
      .andWhere('request.locationId = :locationId', { locationId })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [
          TimeOffStatus.PENDING,
          TimeOffStatus.APPROVED_LOCALLY,
          TimeOffStatus.SYNCING,
          TimeOffStatus.FAILED_HCM, // Still holds the funds until manually resolved
        ],
      })
      .getRawOne<PendingSumResult>();

    // Safely parse the pending sum
    const pendingBalance = parseFloat(
      pendingRequestsQuery?.totalPending ?? '0',
    );

    // 3. The available balance is the ledger base minus the reserved/pending amounts
    const availableBalance = baseBalance - pendingBalance;

    this.logger.debug(
      `Calculated balance for Emp:${employeeId} Loc:${locationId} -> Base:${baseBalance}, Pending:${pendingBalance}, Available:${availableBalance}`,
    );

    return availableBalance;
  }

  /**
   * Calculates the absolute base balance from the ledger history,
   * IGNORING any pending/in-flight requests.
   * This is used strictly for reconciling with the HCM's Source of Truth.
   */
  async getAbsoluteBalance(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    interface LedgerSumResult {
      totalBalance: string | null;
    }

    const ledgerQuery = await this.ledgerRepo
      .createQueryBuilder('ledger')
      .select('SUM(ledger.amount)', 'totalBalance')
      .where('ledger.employeeId = :employeeId', { employeeId })
      .andWhere('ledger.locationId = :locationId', { locationId })
      .getRawOne<LedgerSumResult>();

    return parseFloat(ledgerQuery?.totalBalance ?? '0');
  }

  /**
   * Records a new transaction in the immutable ledger.
   * * @param employeeId - The ID of the employee
   * @param locationId - The location dimension
   * @param type - The type of transaction (ACCRUAL, CONSUMPTION, HCM_ADJUSTMENT)
   * @param amount - The amount to record (absolute value)
   * @param referenceId - Optional UUID of the TimeOffRequest
   */
  async recordTransaction(
    employeeId: string,
    locationId: string,
    type: LedgerTransactionType,
    amount: number,
    referenceId?: string,
  ): Promise<BalanceLedgerEntry> {
    // Safety check: Ensure consumptions are recorded as negative values
    // to keep the SUM calculation mathematically simple and robust.
    const normalizedAmount =
      type === LedgerTransactionType.CONSUMPTION ? -Math.abs(amount) : amount;

    const entry = this.ledgerRepo.create({
      employeeId,
      locationId,
      type,
      amount: normalizedAmount,
      referenceId,
    });

    return this.ledgerRepo.save(entry);
  }
}
