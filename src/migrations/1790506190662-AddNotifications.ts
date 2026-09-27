import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the notifications behind the header bell.
 *
 * Hand-written for the same reason as AddProfileFields: `migration:generate`
 * also emits no-op CHANGE statements for every nullable column in the schema.
 * A user's notifications go when the user does (ON DELETE CASCADE), and the
 * (userId, createdAt) index serves the bell's "latest for me" query.
 */
export class AddNotifications1790506190662 implements MigrationInterface {
  name = 'AddNotifications1790506190662';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE `notifications` (' +
        '`id` varchar(36) NOT NULL, ' +
        '`userId` varchar(36) NOT NULL, ' +
        '`type` varchar(40) NOT NULL, ' +
        '`title` varchar(200) NOT NULL, ' +
        '`message` varchar(500) NOT NULL, ' +
        '`link` varchar(255) NULL, ' +
        '`readAt` timestamp NULL, ' +
        '`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
        'INDEX `IDX_notifications_user_created` (`userId`, `createdAt`), ' +
        'PRIMARY KEY (`id`)' +
        ') ENGINE=InnoDB',
    );
    await queryRunner.query(
      'ALTER TABLE `notifications` ADD CONSTRAINT `FK_notifications_user` ' +
        'FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `notifications` DROP FOREIGN KEY `FK_notifications_user`');
    await queryRunner.query('DROP TABLE `notifications`');
  }
}
