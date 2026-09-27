import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks which reminders a loan has had, so the hourly reminder job sends the
 * "due soon" reminder once and repeats the overdue one only at its interval.
 * Both nullable: existing loans simply have had no reminder yet.
 */
export class AddLoanReminderTracking1790508900000 implements MigrationInterface {
  name = 'AddLoanReminderTracking1790508900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `loans` ADD `dueSoonNotifiedAt` timestamp NULL');
    await queryRunner.query('ALTER TABLE `loans` ADD `overdueNotifiedAt` timestamp NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `loans` DROP COLUMN `overdueNotifiedAt`');
    await queryRunner.query('ALTER TABLE `loans` DROP COLUMN `dueSoonNotifiedAt`');
  }
}
