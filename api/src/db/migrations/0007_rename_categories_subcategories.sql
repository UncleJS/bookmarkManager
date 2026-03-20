RENAME TABLE `classification_groups` TO `categories`, `classifications` TO `subcategories`, `bookmark_classifications` TO `bookmark_subcategories`;--> statement-breakpoint
ALTER TABLE `subcategories` CHANGE COLUMN `group_id` `category_id` int;--> statement-breakpoint
ALTER TABLE `subcategories` DROP INDEX `uniq_active_group_name`;--> statement-breakpoint
ALTER TABLE `subcategories` ADD CONSTRAINT `uniq_active_category_name` UNIQUE(`category_id`,`name_active`);--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP FOREIGN KEY `bookmark_classifications_classification_id_classifications_id_fk`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` CHANGE COLUMN `classification_id` `subcategory_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP INDEX `uniq_active_bookmark_classification`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP COLUMN `classification_id_active`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD `subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN subcategory_id ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` DROP INDEX `idx_bc_classification`;--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD CONSTRAINT `uniq_active_bookmark_subcategory` UNIQUE(`bookmark_id_active`,`subcategory_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD INDEX `idx_bs_subcategory` (`subcategory_id`);--> statement-breakpoint
ALTER TABLE `bookmark_subcategories` ADD CONSTRAINT `bookmark_subcategories_subcategory_id_subcategories_id_fk` FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON DELETE no action ON UPDATE no action;
