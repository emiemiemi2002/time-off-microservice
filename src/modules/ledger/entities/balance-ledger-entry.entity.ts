import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

export enum LedgerTransactionType {
  ACCRUAL = 'ACCRUAL', // Increment (e.g., work anniversary)
  CONSUMPTION = 'CONSUMPTION', // Consumption (e.g., vacation taken)
  HCM_ADJUSTMENT = 'HCM_ADJUSTMENT', // Adjustment after sync batch
}

@Entity('balance_ledger')
export class BalanceLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  @Column()
  locationId!: string;

  @Column({
    type: 'simple-enum',
    enum: LedgerTransactionType,
  })
  type!: LedgerTransactionType;

  @Column('decimal', { precision: 5, scale: 2 })
  amount!: number; // Positive for increments, negative for consumptions

  @Column({ nullable: true })
  referenceId?: string; // ID of the TimeOff request if applicable

  @CreateDateColumn()
  createdAt!: Date;
}
