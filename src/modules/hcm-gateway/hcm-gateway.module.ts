import { Module } from '@nestjs/common';

@Module({
  // This module will encapsulate all external HTTP calls to the HCM API.
  // We keep it separate so the core domain (Time-Off) doesn't know about HCM API details.
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class HcmGatewayModule {}
