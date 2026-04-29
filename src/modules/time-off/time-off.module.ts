import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { HcmGatewayModule } from '../hcm-gateway/hcm-gateway.module';
import { TimeOffController } from './controllers/time-off.controller';
import { TimeOffService } from './services/time-off.service';

@Module({
  // TypeOrmModule.forFeature registers the entity repository in this module's scope.
  // LedgerModule is imported so TimeOffService can use LedgerService to validate balances.
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    LedgerModule,
    HcmGatewayModule,
  ],
  // Controllers handle incoming requests and map them to the appropriate services.
  controllers: [TimeOffController],
  // Providers contain the core business logic (Services, Repositories, Factories, etc.)
  providers: [TimeOffService],
})
export class TimeOffModule {}
