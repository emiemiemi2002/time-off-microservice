import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  // We import TypeOrmModule to register the entity in this scope,
  // and LedgerModule to use the LedgerService for balance validation.
  imports: [TypeOrmModule.forFeature([TimeOffRequest]), LedgerModule],
  controllers: [],
  providers: [],
})
export class TimeOffModule {}
