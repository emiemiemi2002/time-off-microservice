import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../entities/time-off-request.entity';
import { LedgerService } from '../../ledger/services/ledger.service';
import { CreateTimeOffDto } from '../dto/create-time-off.dto';
import { HcmGatewayService } from '../../hcm-gateway/services/hcm-gateway.service';

@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly hcmGatewayService: HcmGatewayService, // <-- Dependency Injection
  ) {}

  /**
   * Creates a new time-off request after verifying available balance.
   * Wraps the operation in a database transaction to ensure atomicity.
   * * @param dto - The validated request payload
   * @returns The newly created TimeOffRequest
   */
  async createRequest(dto: CreateTimeOffDto): Promise<TimeOffRequest> {
    // We initialize a QueryRunner to manually control the database transaction.
    // This prevents scenarios where a request is saved but the subsequent steps fail,
    // leaving orphan data.
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Balance Validation
      // We query the single source of truth (the Ledger) to get the available balance.
      // Note: In a highly concurrent PostgreSQL setup, we might pass the queryRunner.manager
      // to the ledgerService to enforce a row-level lock (SELECT ... FOR UPDATE).
      // For this SQLite implementation, standard transactions provide our safety net.
      const currentBalance = await this.ledgerService.getAvailableBalance(
        dto.employeeId,
        dto.locationId,
      );

      this.logger.debug(
        `Validation -> Emp: ${dto.employeeId}, Requested: ${dto.amount}, Available: ${currentBalance}`,
      );

      if (currentBalance < dto.amount) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${currentBalance}, Requested: ${dto.amount}`,
        );
      }

      // 2. State Mutation (Reservation)
      // We create the request in an 'APPROVED_LOCALLY' state. It acts as a soft-lock
      // on the balance (deducted in real-time by getAvailableBalance calculations)
      // while we wait for the eventual HCM sync.
      const request = new TimeOffRequest();
      request.employeeId = dto.employeeId;
      request.locationId = dto.locationId;
      request.amount = dto.amount;
      request.status = TimeOffStatus.APPROVED_LOCALLY;

      // We explicitly use queryRunner.manager to ensure this save operation
      // is part of the transaction block.
      const savedRequest = await queryRunner.manager.save(request);

      // 3. Commit the transaction locally first!
      await queryRunner.commitTransaction();

      this.logger.log(
        `Successfully created time-off request [${savedRequest.id}] for employee [${dto.employeeId}]`,
      );

      // 4. Background HCM Synchronization (Fire-and-Forget)
      // We do NOT use 'await' here. This allows the HTTP response to be sent back
      // to the user instantly (201 Created), while the sync happens in the background.
      // We attach a .catch() to prevent Unhandled Promise Rejections from crashing Node.js.
      this.hcmGatewayService.processSync(savedRequest.id).catch((error) => {
        this.logger.error(
          `Background HCM sync execution failed for request ${savedRequest.id}`,
          error instanceof Error ? error.stack : 'Unknown error',
        );
      });

      return savedRequest;
    } catch (error) {
      // If any error occurs (business logic or database), we rollback everything.
      await queryRunner.rollbackTransaction();

      this.logger.error(
        `Transaction failed for employee [${dto.employeeId}]: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // Re-throw specific HTTP exceptions so the controller can handle them properly,
      // otherwise wrap generic errors in a 500 Internal Server Error.
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to process the time-off request.',
      );
    } finally {
      // Always release the query runner to prevent connection leaks
      await queryRunner.release();
    }
  }
}
