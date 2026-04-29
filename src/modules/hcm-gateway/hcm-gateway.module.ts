import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmMockClient } from './mocks/hcm-mock.client';
import { HcmGatewayService } from './services/hcm-gateway.service';
import { TimeOffRequest } from '../time-off/entities/time-off-request.entity';
import { BalanceLedgerEntry } from '../ledger/entities/balance-ledger-entry.entity';

@Module({
  // Import the specific entities needed to run queries/transactions in the Gateway
  imports: [TypeOrmModule.forFeature([TimeOffRequest, BalanceLedgerEntry])],
  providers: [HcmMockClient, HcmGatewayService],
  exports: [HcmGatewayService], // Exported so it can be triggered by other modules/controllers
})
export class HcmGatewayModule {}
