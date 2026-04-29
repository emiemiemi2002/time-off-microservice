import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HcmGatewayService } from '../services/hcm-gateway.service';
import { BatchSyncDto } from '../dto/batch-sync.dto';

@Controller('webhooks/hcm')
export class HcmGatewayController {
  private readonly logger = new Logger(HcmGatewayController.name);

  constructor(private readonly hcmGatewayService: HcmGatewayService) {}

  /**
   * Webhook endpoint triggered by the HCM to provide massive balance updates.
   */
  @Post('batch-sync')
  @HttpCode(HttpStatus.OK)
  async handleBatchSync(@Body() batchSyncDto: BatchSyncDto) {
    this.logger.log(
      `Received HCM Batch Sync payload with ${batchSyncDto.balances.length} records.`,
    );

    const result = await this.hcmGatewayService.processBatchSync(batchSyncDto);

    this.logger.log(`Batch Sync Complete: ${JSON.stringify(result)}`);
    return result; // We return the summary to the HCM for auditing
  }
}
