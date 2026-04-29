import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LedgerService } from './ledger.service';
import {
  BalanceLedgerEntry,
  LedgerTransactionType,
} from '../entities/balance-ledger-entry.entity';
import { TimeOffRequest } from '../../time-off/entities/time-off-request.entity';

describe('LedgerService', () => {
  let service: LedgerService;

  // We create a reusable mock for the QueryBuilder to chain methods and simulate DB results.
  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  const mockLedgerRepo = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockRequestRepo = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    // Clear all mock interactions before each test to ensure test isolation.
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        {
          provide: getRepositoryToken(BalanceLedgerEntry),
          useValue: mockLedgerRepo,
        },
        {
          provide: getRepositoryToken(TimeOffRequest),
          useValue: mockRequestRepo,
        },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAvailableBalance (Category 1 Test Cases)', () => {
    const employeeId = 'emp-123';
    const locationId = 'loc-abc';

    it('TC1.1: Calculate basic positive balance (Only Accruals)', async () => {
      // Given: The ledger sum returns 10, and there are no pending requests
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ totalBalance: '10' }) // ledger repo call
        .mockResolvedValueOnce({ totalPending: null }); // request repo call

      // When
      const balance = await service.getAvailableBalance(employeeId, locationId);

      // Then
      expect(balance).toBe(10);
      expect(mockLedgerRepo.createQueryBuilder).toHaveBeenCalledWith('ledger');
      expect(mockRequestRepo.createQueryBuilder).toHaveBeenCalledWith(
        'request',
      );
    });

    it('TC1.2: Calculate balance with consumptions', async () => {
      // Given: The database sum of Accruals (10) + Consumptions (-3) = 7
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ totalBalance: '7' })
        .mockResolvedValueOnce({ totalPending: null });

      // When
      const balance = await service.getAvailableBalance(employeeId, locationId);

      // Then
      expect(balance).toBe(7);
    });

    it('TC1.3: Calculate balance considering pending requests', async () => {
      // Given: Ledger base is 5, but there is a pending request of 2
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ totalBalance: '5' })
        .mockResolvedValueOnce({ totalPending: '2' });

      // When
      const balance = await service.getAvailableBalance(employeeId, locationId);

      // Then: 5 - 2 = 3
      expect(balance).toBe(3);
    });

    it('TC1.4: Ledger calculation after HCM Batch Adjustment', async () => {
      // Given: Accrual (5) + HCM Adjustment (-1) = 4
      mockQueryBuilder.getRawOne
        .mockResolvedValueOnce({ totalBalance: '4' })
        .mockResolvedValueOnce({ totalPending: null });

      // When
      const balance = await service.getAvailableBalance(employeeId, locationId);

      // Then
      expect(balance).toBe(4);
    });
  });

  describe('recordTransaction', () => {
    it('should normalize CONSUMPTION amounts to negative values', async () => {
      // Given
      const amount = 5; // A positive 5 is sent
      const expectedNormalizedAmount = -5;

      // We explicitly type the input as Partial<BalanceLedgerEntry> and cast the return.
      // This satisfies the strict 'no-unsafe-return' linting rules.
      mockLedgerRepo.create.mockImplementation(
        (dto: Partial<BalanceLedgerEntry>) => dto as BalanceLedgerEntry,
      );

      // Instead of an empty async function without await, we return a Promise.resolve().
      mockLedgerRepo.save.mockImplementation(
        (entity: Partial<BalanceLedgerEntry>) =>
          Promise.resolve({
            id: 'uuid',
            ...entity,
          } as BalanceLedgerEntry),
      );

      // When
      const result = await service.recordTransaction(
        'emp-1',
        'loc-1',
        LedgerTransactionType.CONSUMPTION,
        amount,
      );

      // Then
      expect(mockLedgerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expectedNormalizedAmount,
          type: LedgerTransactionType.CONSUMPTION,
        }),
      );
      expect(result.amount).toBe(expectedNormalizedAmount);
    });

    it('should keep ACCRUAL amounts as positive values', async () => {
      // Given
      // We explicitly type the input as Partial<BalanceLedgerEntry> and cast the return.
      // This satisfies the strict 'no-unsafe-return' linting rules.
      mockLedgerRepo.create.mockImplementation(
        (dto: Partial<BalanceLedgerEntry>) => dto as BalanceLedgerEntry,
      );

      // Instead of an empty async function without await, we return a Promise.resolve().
      mockLedgerRepo.save.mockImplementation(
        (entity: Partial<BalanceLedgerEntry>) =>
          Promise.resolve({
            id: 'uuid',
            ...entity,
          } as BalanceLedgerEntry),
      );

      // When
      const result = await service.recordTransaction(
        'emp-1',
        'loc-1',
        LedgerTransactionType.ACCRUAL,
        5,
      );

      // Then
      expect(result.amount).toBe(5);
    });
  });
});
