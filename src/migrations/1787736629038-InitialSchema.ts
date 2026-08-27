import {MigrationInterface, QueryRunner} from "typeorm";

export class InitialSchema1787736629038 implements MigrationInterface {
    name = 'InitialSchema1787736629038'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`books\` (\`id\` varchar(36) NOT NULL, \`title\` varchar(255) NOT NULL, \`author\` varchar(255) NOT NULL, \`isbn\` varchar(255) NOT NULL, \`category\` varchar(255) NOT NULL, \`totalCopies\` int NOT NULL DEFAULT '0', \`availableCopies\` int NOT NULL DEFAULT '0', \`description\` text NULL, \`publishedDate\` date NULL, \`isEbook\` tinyint NOT NULL DEFAULT 0, \`filePath\` varchar(500) NULL, \`status\` enum ('working', 'reviewing', 'approved', 'declined', 'deprecated') NOT NULL DEFAULT 'reviewing', \`approvedBy\` varchar(36) NULL, \`approvedAt\` timestamp NULL, \`rejectionReason\` text NULL, \`deprecationReason\` text NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE INDEX \`IDX_54337dc30d9bb2c3fadebc6909\` (\`isbn\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`loans\` (\`id\` varchar(36) NOT NULL, \`bookId\` varchar(36) NOT NULL, \`userId\` varchar(36) NOT NULL, \`borrowDate\` date NOT NULL, \`dueDate\` date NOT NULL, \`returnDate\` date NULL, \`status\` enum ('pending', 'active', 'returned', 'overdue', 'declined') NOT NULL DEFAULT 'pending', \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`groups\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`description\` text NULL, \`isDefault\` tinyint NOT NULL DEFAULT 0, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE INDEX \`IDX_664ea405ae2a10c264d582ee56\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`roles\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`resource\` varchar(255) NOT NULL, \`action\` varchar(255) NOT NULL, \`description\` text NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE INDEX \`IDX_648e3f5447f725579d7d4ffdfb\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`email\` varchar(255) NOT NULL, \`phone\` varchar(255) NOT NULL, \`address\` text NULL, \`password\` varchar(255) NULL, \`securityQuestion\` text NULL, \`securityAnswer\` text NULL, \`blocked\` tinyint NOT NULL DEFAULT 0, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`refresh_tokens\` (\`id\` varchar(36) NOT NULL, \`userId\` varchar(36) NOT NULL, \`tokenHash\` varchar(64) NOT NULL, \`expiresAt\` timestamp NOT NULL, \`revokedAt\` timestamp NULL, \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE INDEX \`IDX_refresh_tokens_token_hash\` (\`tokenHash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`group_roles\` (\`groupId\` varchar(36) NOT NULL, \`roleId\` varchar(36) NOT NULL, INDEX \`IDX_2b5f930e296a7d2bf3b14e59f4\` (\`groupId\`), INDEX \`IDX_69f84cc2625ddd7555de6ee745\` (\`roleId\`), PRIMARY KEY (\`groupId\`, \`roleId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`user_roles\` (\`userId\` varchar(36) NOT NULL, \`roleId\` varchar(36) NOT NULL, INDEX \`IDX_472b25323af01488f1f66a06b6\` (\`userId\`), INDEX \`IDX_86033897c009fcca8b6505d6be\` (\`roleId\`), PRIMARY KEY (\`userId\`, \`roleId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`user_groups\` (\`userId\` varchar(36) NOT NULL, \`groupId\` varchar(36) NOT NULL, INDEX \`IDX_99d01ff7f143377c044f3d6c95\` (\`userId\`), INDEX \`IDX_4dcea3f5c6f04650517d9dc475\` (\`groupId\`), PRIMARY KEY (\`userId\`, \`groupId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`books\` ADD CONSTRAINT \`FK_6dccfc294593f5c31efd29cf6d2\` FOREIGN KEY (\`approvedBy\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`loans\` ADD CONSTRAINT \`FK_aad54a9134e293d4d3be70db995\` FOREIGN KEY (\`bookId\`) REFERENCES \`books\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`loans\` ADD CONSTRAINT \`FK_4c2ab4e556520045a2285916d45\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`refresh_tokens\` ADD CONSTRAINT \`FK_610102b60fea1455310ccd299de\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`group_roles\` ADD CONSTRAINT \`FK_2b5f930e296a7d2bf3b14e59f42\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`group_roles\` ADD CONSTRAINT \`FK_69f84cc2625ddd7555de6ee7458\` FOREIGN KEY (\`roleId\`) REFERENCES \`roles\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_472b25323af01488f1f66a06b67\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_86033897c009fcca8b6505d6be2\` FOREIGN KEY (\`roleId\`) REFERENCES \`roles\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_groups\` ADD CONSTRAINT \`FK_99d01ff7f143377c044f3d6c955\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`user_groups\` ADD CONSTRAINT \`FK_4dcea3f5c6f04650517d9dc4750\` FOREIGN KEY (\`groupId\`) REFERENCES \`groups\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user_groups\` DROP FOREIGN KEY \`FK_4dcea3f5c6f04650517d9dc4750\``);
        await queryRunner.query(`ALTER TABLE \`user_groups\` DROP FOREIGN KEY \`FK_99d01ff7f143377c044f3d6c955\``);
        await queryRunner.query(`ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_86033897c009fcca8b6505d6be2\``);
        await queryRunner.query(`ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_472b25323af01488f1f66a06b67\``);
        await queryRunner.query(`ALTER TABLE \`group_roles\` DROP FOREIGN KEY \`FK_69f84cc2625ddd7555de6ee7458\``);
        await queryRunner.query(`ALTER TABLE \`group_roles\` DROP FOREIGN KEY \`FK_2b5f930e296a7d2bf3b14e59f42\``);
        await queryRunner.query(`ALTER TABLE \`refresh_tokens\` DROP FOREIGN KEY \`FK_610102b60fea1455310ccd299de\``);
        await queryRunner.query(`ALTER TABLE \`loans\` DROP FOREIGN KEY \`FK_4c2ab4e556520045a2285916d45\``);
        await queryRunner.query(`ALTER TABLE \`loans\` DROP FOREIGN KEY \`FK_aad54a9134e293d4d3be70db995\``);
        await queryRunner.query(`ALTER TABLE \`books\` DROP FOREIGN KEY \`FK_6dccfc294593f5c31efd29cf6d2\``);
        await queryRunner.query(`DROP INDEX \`IDX_4dcea3f5c6f04650517d9dc475\` ON \`user_groups\``);
        await queryRunner.query(`DROP INDEX \`IDX_99d01ff7f143377c044f3d6c95\` ON \`user_groups\``);
        await queryRunner.query(`DROP TABLE \`user_groups\``);
        await queryRunner.query(`DROP INDEX \`IDX_86033897c009fcca8b6505d6be\` ON \`user_roles\``);
        await queryRunner.query(`DROP INDEX \`IDX_472b25323af01488f1f66a06b6\` ON \`user_roles\``);
        await queryRunner.query(`DROP TABLE \`user_roles\``);
        await queryRunner.query(`DROP INDEX \`IDX_69f84cc2625ddd7555de6ee745\` ON \`group_roles\``);
        await queryRunner.query(`DROP INDEX \`IDX_2b5f930e296a7d2bf3b14e59f4\` ON \`group_roles\``);
        await queryRunner.query(`DROP TABLE \`group_roles\``);
        await queryRunner.query(`DROP INDEX \`IDX_refresh_tokens_token_hash\` ON \`refresh_tokens\``);
        await queryRunner.query(`DROP TABLE \`refresh_tokens\``);
        await queryRunner.query(`DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
        await queryRunner.query(`DROP INDEX \`IDX_648e3f5447f725579d7d4ffdfb\` ON \`roles\``);
        await queryRunner.query(`DROP TABLE \`roles\``);
        await queryRunner.query(`DROP INDEX \`IDX_664ea405ae2a10c264d582ee56\` ON \`groups\``);
        await queryRunner.query(`DROP TABLE \`groups\``);
        await queryRunner.query(`DROP TABLE \`loans\``);
        await queryRunner.query(`DROP INDEX \`IDX_54337dc30d9bb2c3fadebc6909\` ON \`books\``);
        await queryRunner.query(`DROP TABLE \`books\``);
    }

}
