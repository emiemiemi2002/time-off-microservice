import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceLedgerEntry } from './entities/balance-ledger-entry.entity';
import { TimeOffRequest } from '../time-off/entities/time-off-request.entity';
import { LedgerService } from './services/ledger.service';

@Module({
  // We import TimeOffRequest here to calculate pending balances
  imports: [TypeOrmModule.forFeature([BalanceLedgerEntry, TimeOffRequest])],
  providers: [LedgerService],
  exports: [LedgerService], // Exported so TimeOffModule can use it to validate requests
})
export class LedgerModule {}
