import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmMockClient } from './mocks/hcm-mock.client';
import { HcmGatewayService } from './services/hcm-gateway.service';
import { HcmGatewayController } from './controllers/hcm-gateway.controller'; // <-- Import Controller
import { TimeOffRequest } from '../time-off/entities/time-off-request.entity';
import { BalanceLedgerEntry } from '../ledger/entities/balance-ledger-entry.entity';
import { LedgerModule } from '../ledger/ledger.module'; // <-- Import LedgerModule

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest, BalanceLedgerEntry]),
    LedgerModule,
  ],
  controllers: [HcmGatewayController],
  providers: [HcmMockClient, HcmGatewayService],
  exports: [HcmGatewayService],
})
export class HcmGatewayModule {}
