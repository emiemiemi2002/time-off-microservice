import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { TimeOffService } from '../services/time-off.service';
import { CreateTimeOffDto } from '../dto/create-time-off.dto';
import { TimeOffRequest } from '../entities/time-off-request.entity';

@Controller('time-off')
export class TimeOffController {
  private readonly logger = new Logger(TimeOffController.name);

  // We inject the TimeOffService. The controller relies entirely on the service
  // to handle business rules and database transactions (Thin Controller pattern).
  constructor(private readonly timeOffService: TimeOffService) {}

  /**
   * Endpoint to submit a new time-off request.
   * We explicitly set the HTTP status code to 201 (Created) for successful POST requests.
   * * @param createTimeOffDto - The validated payload from the client
   * @returns The newly created TimeOffRequest entity
   */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async createRequest(
    @Body() createTimeOffDto: CreateTimeOffDto,
  ): Promise<TimeOffRequest> {
    this.logger.log(
      `Received time-off request for employee: ${createTimeOffDto.employeeId}`,
    );

    // The Global ValidationPipe ensures createTimeOffDto is strictly typed and valid
    // before it even reaches this line.
    return await this.timeOffService.createRequest(createTimeOffDto);
  }
}
