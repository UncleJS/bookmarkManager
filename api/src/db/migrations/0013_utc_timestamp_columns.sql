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
SET time_zone = '+00:00';--> statement-breakpoint
ALTER TABLE `categories` DROP INDEX `uniq_active_categories_name`, DROP COLUMN `name_active`;--> statement-breakpoint
ALTER TABLE `categories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `name_active` varchar(255) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_categories_name` UNIQUE(`name_active`);--> statement-breakpoint
ALTER TABLE `subcategories` DROP INDEX `uniq_active_category_name`, DROP COLUMN `name_active`;--> statement-breakpoint
ALTER TABLE `subcategories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `subcategories` ADD `name_active` text GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_category_name` UNIQUE(`category_id`,`name_active`);--> statement-breakpoint
ALTER TABLE `sub_subcategories` DROP INDEX `uniq_active_subcategory_child_name`, DROP COLUMN `name_active`;--> statement-breakpoint
ALTER TABLE `sub_subcategories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `sub_subcategories` ADD `name_active` text GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_subcategory_child_name` UNIQUE(`subcategory_id`,`name_active`);--> statement-breakpoint
ALTER TABLE `tags` DROP INDEX `uniq_active_tag_name`, DROP COLUMN `name_active`;--> statement-breakpoint
ALTER TABLE `tags` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `name_active` varchar(255) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN name ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_tag_name` UNIQUE(`name_active`);--> statement-breakpoint
ALTER TABLE `bookmarks` DROP INDEX `uniq_active_bookmark_url`, DROP COLUMN `url_hash_active`;--> statement-breakpoint
ALTER TABLE `bookmarks` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `updated_at` `updated_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `url_hash_active` varchar(64) GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN SHA2(url, 256) ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_bookmark_url` UNIQUE(`url_hash_active`);--> statement-breakpoint
ALTER TABLE `bookmark_tags` DROP INDEX `uniq_active_bookmark_tag`, DROP COLUMN `bookmark_id_active`, DROP COLUMN `tag_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_tags` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD `tag_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN tag_id ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_bookmark_tag` UNIQUE(`bookmark_id_active`,`tag_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_categories` DROP INDEX `uniq_active_bookmark_category`, DROP COLUMN `bookmark_id_active`, DROP COLUMN `category_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_categories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_categories` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD `category_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN category_id ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_bookmark_category` UNIQUE(`bookmark_id_active`,`category_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP INDEX `uniq_active_bookmark_subcategory`, DROP COLUMN `bookmark_id_active`, DROP COLUMN `subcategory_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD `subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN subcategory_id ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_bookmark_subcategory` UNIQUE(`bookmark_id_active`,`subcategory_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` DROP INDEX `uniq_active_bookmark_sub_subcategory`, DROP COLUMN `bookmark_id_active`, DROP COLUMN `sub_subcategory_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` CHANGE COLUMN `created_at` `created_UTC` datetime NULL DEFAULT (UTC_TIMESTAMP()), CHANGE COLUMN `archived_at` `archived_UTC` datetime NULL;--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN bookmark_id ELSE NULL END) STORED, ADD `sub_subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_UTC IS NULL THEN sub_subcategory_id ELSE NULL END) STORED, ADD CONSTRAINT `uniq_active_bookmark_sub_subcategory` UNIQUE(`bookmark_id_active`,`sub_subcategory_id_active`);
