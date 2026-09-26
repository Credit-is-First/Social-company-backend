import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the individual-details fields a member must supply before borrowing.
 *
 * Hand-written rather than generated: `migration:generate` also emitted around
 * fifty no-op CHANGE statements across every table, because MySQL reports
 * nullable columns as having a literal 'NULL' string default and TypeORM sees
 * that as a difference. Its down() would have written that bogus default back.
 *
 * All four columns are nullable, so existing rows are untouched — an account
 * created before this simply reads as an incomplete profile until the member
 * fills it in.
 */
export class AddProfileFields1787901926102 implements MigrationInterface {
  name = 'AddProfileFields1787901926102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `users` ADD `dateOfBirth` date NULL');
    await queryRunner.query(
      "ALTER TABLE `users` ADD `gender` enum ('male', 'female', 'other', 'prefer_not_to_say') NULL",
    );
    await queryRunner.query('ALTER TABLE `users` ADD `occupation` varchar(120) NULL');
    await queryRunner.query('ALTER TABLE `users` ADD `photoPath` varchar(500) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `photoPath`');
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `occupation`');
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `gender`');
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `dateOfBirth`');
  }
}
