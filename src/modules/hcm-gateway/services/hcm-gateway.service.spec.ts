import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HcmGatewayService } from './hcm-gateway.service';
import { HcmMockClient } from '../mocks/hcm-mock.client';
import { LedgerService } from '../../ledger/services/ledger.service';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../../time-off/entities/time-off-request.entity';
import { LedgerTransactionType } from '../../ledger/entities/balance-ledger-entry.entity';
import { BatchSyncDto } from '../dto/batch-sync.dto';

describe('HcmGatewayService', () => {
  let service: HcmGatewayService;

  // Transaction Mocking
  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockRequestRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    getRepository: jest.fn((entity) => {
      if (entity === TimeOffRequest) return mockRequestRepo;
      return {};
    }),
  };

  const mockHcmClient = {
    syncTimeOffRequest: jest.fn(),
  };

  const mockLedgerService = {
    getAbsoluteBalance: jest.fn(),
    getAvailableBalance: jest.fn(),
    recordTransaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmGatewayService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: HcmMockClient, useValue: mockHcmClient },
        { provide: LedgerService, useValue: mockLedgerService },
      ],
    }).compile();

    service = module.get<HcmGatewayService>(HcmGatewayService);
  });

  describe('processSync (Category 3: Defensive Programming)', () => {
    const validRequest = {
      id: 'req-1',
      employeeId: 'emp-1',
      locationId: 'loc-1',
      amount: 2,
      status: TimeOffStatus.APPROVED_LOCALLY,
    } as TimeOffRequest;

    it('TC2.2: Should complete request and update ledger on HCM Success', async () => {
      // Given
      mockRequestRepo.findOne.mockResolvedValueOnce(validRequest);
      mockHcmClient.syncTimeOffRequest.mockResolvedValueOnce({
        success: true,
        externalId: 'ext-1',
      });

      // When
      await service.processSync('req-1');

      // Then
      expect(mockRequestRepo.update).toHaveBeenCalledWith('req-1', {
        status: TimeOffStatus.SYNCING,
      });
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        TimeOffRequest,
        'req-1',
        { status: TimeOffStatus.COMPLETED },
      );
      // Verify a permanent consumption was saved to the ledger
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LedgerTransactionType.CONSUMPTION,
          amount: -2,
        }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('TC3.4: Should mark as REJECTED and not deduct ledger on explicit HCM Rejection', async () => {
      // Given
      mockRequestRepo.findOne.mockResolvedValueOnce(validRequest);
      mockHcmClient.syncTimeOffRequest.mockResolvedValueOnce({
        success: false,
        reason: 'REJECTED',
      });

      // When
      await service.processSync('req-1');

      // Then
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        TimeOffRequest,
        'req-1',
        { status: TimeOffStatus.REJECTED },
      );
      // Ledger save should NOT be called
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('TC3.3: Should mark as FAILED_HCM on network timeout (Preventing Double Spend)', async () => {
      // Given
      mockRequestRepo.findOne.mockResolvedValueOnce(validRequest);
      mockHcmClient.syncTimeOffRequest.mockResolvedValueOnce({
        success: false,
        reason: 'TIMEOUT',
      });

      // When
      await service.processSync('req-1');

      // Then
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        TimeOffRequest,
        'req-1',
        { status: TimeOffStatus.FAILED_HCM },
      );
      // Funds remain locked by the FAILED_HCM status, no ledger entry made yet
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalled();
    });
  });

  describe('processBatchSync (Category 4: Reconciliation & Self-Healing)', () => {
    it('TC4.1: Should do nothing if HCM balance matches local Absolute balance', async () => {
      // Given: HCM says 10, Local Absolute says 10
      const dto: BatchSyncDto = {
        balances: [{ employeeId: 'emp-1', locationId: 'loc-1', balance: 10 }],
      };
      mockLedgerService.getAbsoluteBalance.mockResolvedValueOnce(10);

      // When
      const result = await service.processBatchSync(dto);

      // Then
      expect(result.adjustments).toBe(0);
      expect(mockLedgerService.recordTransaction).not.toHaveBeenCalled();
    });

    it('TC4.2: Should create a positive adjustment if HCM balance is higher (e.g. Work Anniversary)', async () => {
      // Given: HCM says 15, Local Absolute says 10
      const dto: BatchSyncDto = {
        balances: [{ employeeId: 'emp-1', locationId: 'loc-1', balance: 15 }],
      };
      mockLedgerService.getAbsoluteBalance.mockResolvedValueOnce(10);
      // Available balance is healthy (15)
      mockLedgerService.getAvailableBalance.mockResolvedValueOnce(15);

      // When
      const result = await service.processBatchSync(dto);

      // Then
      expect(result.adjustments).toBe(1);
      expect(mockLedgerService.recordTransaction).toHaveBeenCalledWith(
        'emp-1',
        'loc-1',
        LedgerTransactionType.HCM_ADJUSTMENT,
        5,
        'BATCH-SYNC-WEBHOOK',
      );
      expect(result.cancellations).toBe(0);
    });

    it('TC4.4: Should cancel pending requests if an external deduction causes an overdraft', async () => {
      // Given: HCM says 2, Local Absolute was 10.
      const dto: BatchSyncDto = {
        balances: [{ employeeId: 'emp-1', locationId: 'loc-1', balance: 2 }],
      };
      mockLedgerService.getAbsoluteBalance.mockResolvedValueOnce(10);

      // Simulate that after applying the -8 adjustment, the available balance is now -3
      // because there is a pending request for 5 days.
      mockLedgerService.getAvailableBalance.mockResolvedValueOnce(-3);

      // Mock the pending requests
      const pendingReq = { id: 'req-pending', amount: 5 } as TimeOffRequest;
      mockRequestRepo.find.mockResolvedValueOnce([pendingReq]);

      // When
      const result = await service.processBatchSync(dto);

      // Then
      expect(result.adjustments).toBe(1);
      expect(mockLedgerService.recordTransaction).toHaveBeenCalledWith(
        'emp-1',
        'loc-1',
        LedgerTransactionType.HCM_ADJUSTMENT,
        -8,
        'BATCH-SYNC-WEBHOOK',
      );

      // Verify self-healing: it cancelled the pending request
      expect(mockRequestRepo.update).toHaveBeenCalledWith('req-pending', {
        status: TimeOffStatus.REJECTED,
      });
      expect(result.cancellations).toBe(1);
    });
  });
});
