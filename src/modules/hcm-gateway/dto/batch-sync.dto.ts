import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class HcmBalanceRecordDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  balance!: number; // The absolute truth balance coming from the HCM
}

export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HcmBalanceRecordDto) // Crucial for class-transformer to instantiate nested objects
  balances!: HcmBalanceRecordDto[];
}
