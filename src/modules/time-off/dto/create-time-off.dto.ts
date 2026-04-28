import { IsString, IsNotEmpty, IsNumber, IsPositive } from 'class-validator';

export class CreateTimeOffDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
