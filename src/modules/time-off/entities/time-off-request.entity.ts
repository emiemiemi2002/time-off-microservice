import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TimeOffStatus {
  PENDING = 'PENDING',
  APPROVED_LOCALLY = 'APPROVED_LOCALLY',
  SYNCING = 'SYNCING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  FAILED_HCM = 'FAILED_HCM',
}

@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  @Column()
  locationId!: string;

  @Column('decimal', { precision: 5, scale: 2 })
  amount!: number;

  @Column({
    type: 'simple-enum',
    enum: TimeOffStatus,
    default: TimeOffStatus.PENDING,
  })
  status!: TimeOffStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
