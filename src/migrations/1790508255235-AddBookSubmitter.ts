import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records who sent each book for review, so they can be notified when it is
 * approved or declined.
 *
 * Nullable: books that already exist have no known submitter and simply send
 * no such notification. ON DELETE SET NULL, unlike approvedBy, so deleting a
 * user never fails because of books they once submitted.
 */
export class AddBookSubmitter1790508255235 implements MigrationInterface {
  name = 'AddBookSubmitter1790508255235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `books` ADD `submittedBy` varchar(36) NULL');
    await queryRunner.query(
      'ALTER TABLE `books` ADD CONSTRAINT `FK_books_submitted_by` ' +
        'FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `books` DROP FOREIGN KEY `FK_books_submitted_by`');
    await queryRunner.query('ALTER TABLE `books` DROP COLUMN `submittedBy`');
  }
}
