import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TimeOffService } from './time-off.service';
import { LedgerService } from '../../ledger/services/ledger.service';
import { HcmGatewayService } from '../../hcm-gateway/services/hcm-gateway.service';
import { TimeOffStatus } from '../entities/time-off-request.entity';
import { CreateTimeOffDto } from '../dto/create-time-off.dto';

describe('TimeOffService', () => {
  let service: TimeOffService;

  // 1. We create a strict mock for the QueryRunner to track transaction lifecycles
  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {
      save: jest.fn(),
    },
  };

  // 2. Mock for the DataSource that returns our QueryRunner
  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockLedgerService = {
    getAvailableBalance: jest.fn(),
  };

  const mockHcmGatewayService = {
    // Mocked to resolve immediately to simulate the fire-and-forget behavior
    processSync: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: LedgerService,
          useValue: mockLedgerService,
        },
        {
          provide: HcmGatewayService,
          useValue: mockHcmGatewayService,
        },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRequest', () => {
    const validDto: CreateTimeOffDto = {
      employeeId: 'emp-1',
      locationId: 'loc-1',
      amount: 2,
    };

    it('TC2.1: Should successfully create a request and trigger async sync (Happy Path)', async () => {
      // Given: Employee has enough balance (5 available, wants 2)
      mockLedgerService.getAvailableBalance.mockResolvedValueOnce(5);

      // Strongly typed mock for the save method.
      // We explicitly resolve a full object to ensure the 'id' is present for the async sync call.
      mockQueryRunner.manager.save.mockResolvedValueOnce({
        id: 'req-uuid',
        employeeId: validDto.employeeId,
        locationId: validDto.locationId,
        amount: validDto.amount,
        status: TimeOffStatus.APPROVED_LOCALLY,
      });

      // When
      const result = await service.createRequest(validDto);

      // Then
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: validDto.employeeId,
          amount: validDto.amount,
          status: TimeOffStatus.APPROVED_LOCALLY,
        }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      // Verify Fire-and-Forget HCM Sync was triggered
      expect(mockHcmGatewayService.processSync).toHaveBeenCalledWith(
        'req-uuid',
      );

      // Verify the returned object
      expect(result.id).toBe('req-uuid');
      expect(result.status).toBe(TimeOffStatus.APPROVED_LOCALLY);
    });

    it('TC3.1: Should throw BadRequestException and rollback if balance is insufficient', async () => {
      // Given: Employee only has 1 day available, but wants 2
      mockLedgerService.getAvailableBalance.mockResolvedValueOnce(1);

      // When & Then
      await expect(service.createRequest(validDto)).rejects.toThrow(
        BadRequestException,
      );

      // Verify transaction was rolled back and NOT committed
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      // Ensure we don't trigger the external sync if local validation fails
      expect(mockHcmGatewayService.processSync).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException and rollback if database fails', async () => {
      // Given: Balance is fine, but the database crashes during save
      mockLedgerService.getAvailableBalance.mockResolvedValueOnce(5);
      mockQueryRunner.manager.save.mockRejectedValueOnce(
        new Error('DB Connection Lost'),
      );

      // When & Then
      await expect(service.createRequest(validDto)).rejects.toThrow(
        InternalServerErrorException,
      );

      // Verify the rollback sequence
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalled(); // It tried to save
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled(); // Handled the crash safely
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });
});
