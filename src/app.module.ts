import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { TimeOffModule } from './modules/time-off/time-off.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { HcmGatewayModule } from './modules/hcm-gateway/hcm-gateway.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const typeOrmModule = TypeOrmModule as unknown as {
  forRoot: (options: TypeOrmModuleOptions) => DynamicModule;
};

const typeOrmOptions: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: 'database.sqlite',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  synchronize: true, // Only for quick development; use migrations in production
  logging: false,
};

@Module({
  imports: [
    typeOrmModule.forRoot(typeOrmOptions),
    TimeOffModule,
    LedgerModule,
    HcmGatewayModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
