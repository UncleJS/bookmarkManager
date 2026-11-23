-- Timestamp columns follow the UTC rule: every date/time column is named
-- *_UTC and holds UTC.
--   created_at  TIMESTAMP -> created_UTC  DATETIME DEFAULT (UTC_TIMESTAMP())
--   updated_at  TIMESTAMP -> updated_UTC  DATETIME DEFAULT (UTC_TIMESTAMP())
--               (ON UPDATE CURRENT_TIMESTAMP dropped; the API sets it)
--   archived_at DATETIME  -> archived_UTC DATETIME
-- TIMESTAMP -> DATETIME converts through the session time zone, so it is
-- pinned to UTC first: existing values keep the same instant, no data loss.
-- The generated *_active columns read archived_at, so they and their unique
-- indexes are dropped before the rename and rebuilt on archived_UTC.
-- MariaDB commits each ALTER on its own, so every statement is written to be
-- safe to re-run: a migration that stops half-way can simply be run again.
-- Take a backup (scripts/backup.sh) before deploying this release.
SET time_zone = '+00:00';--> statement-breakpoint
ALTER TABLE `categories` DROP INDEX IF EXISTS `uniq_active_categories_name`, DROP COLUMN IF EXISTS `name_active`;--> statement-breakpoint
ALTER TABLE `categories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `name_active` varchar(255) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_categories_name` (`name_active`);--> statement-breakpoint
ALTER TABLE `subcategories` DROP INDEX IF EXISTS `uniq_active_category_name`, DROP COLUMN IF EXISTS `name_active`;--> statement-breakpoint
ALTER TABLE `subcategories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `subcategories` ADD COLUMN IF NOT EXISTS `name_active` text GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_category_name` (`category_id`,`name_active`);--> statement-breakpoint
ALTER TABLE `sub_subcategories` DROP INDEX IF EXISTS `uniq_active_subcategory_child_name`, DROP COLUMN IF EXISTS `name_active`;--> statement-breakpoint
ALTER TABLE `sub_subcategories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `sub_subcategories` ADD COLUMN IF NOT EXISTS `name_active` text GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_subcategory_child_name` (`subcategory_id`,`name_active`);--> statement-breakpoint
ALTER TABLE `tags` DROP INDEX IF EXISTS `uniq_active_tag_name`, DROP COLUMN IF EXISTS `name_active`;--> statement-breakpoint
ALTER TABLE `tags` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN IF NOT EXISTS `name_active` varchar(255) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_tag_name` (`name_active`);--> statement-breakpoint
ALTER TABLE `bookmarks` DROP INDEX IF EXISTS `uniq_active_bookmark_url`, DROP COLUMN IF EXISTS `url_hash_active`;--> statement-breakpoint
ALTER TABLE `bookmarks` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `updated_at` `updated_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD COLUMN IF NOT EXISTS `url_hash_active` varchar(64) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN SHA2(url, 256) ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_bookmark_url` (`url_hash_active`);--> statement-breakpoint
ALTER TABLE `bookmark_tags` DROP INDEX IF EXISTS `uniq_active_bookmark_tag`, DROP COLUMN IF EXISTS `bookmark_id_active`, DROP COLUMN IF EXISTS `tag_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_tags` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD COLUMN IF NOT EXISTS `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD COLUMN IF NOT EXISTS `tag_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN tag_id ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_bookmark_tag` (`bookmark_id_active`,`tag_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_categories` DROP INDEX IF EXISTS `uniq_active_bookmark_category`, DROP COLUMN IF EXISTS `bookmark_id_active`, DROP COLUMN IF EXISTS `category_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_categories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_categories` ADD COLUMN IF NOT EXISTS `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD COLUMN IF NOT EXISTS `category_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN category_id ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_bookmark_category` (`bookmark_id_active`,`category_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP INDEX IF EXISTS `uniq_active_bookmark_subcategory`, DROP COLUMN IF EXISTS `bookmark_id_active`, DROP COLUMN IF EXISTS `subcategory_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD COLUMN IF NOT EXISTS `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD COLUMN IF NOT EXISTS `subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN subcategory_id ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_bookmark_subcategory` (`bookmark_id_active`,`subcategory_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` DROP INDEX IF EXISTS `uniq_active_bookmark_sub_subcategory`, DROP COLUMN IF EXISTS `bookmark_id_active`, DROP COLUMN IF EXISTS `sub_subcategory_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` CHANGE COLUMN IF EXISTS `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN IF EXISTS `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` ADD COLUMN IF NOT EXISTS `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD COLUMN IF NOT EXISTS `sub_subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN sub_subcategory_id ELSE NULL END) STORED, ADD UNIQUE KEY IF NOT EXISTS `uniq_active_bookmark_sub_subcategory` (`bookmark_id_active`,`sub_subcategory_id_active`);
