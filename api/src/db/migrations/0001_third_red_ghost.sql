ALTER TABLE `bookmark_classifications` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `bookmark_tags` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `bookmark_classifications` ADD `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY FIRST;--> statement-breakpoint
ALTER TABLE `bookmark_classifications` ADD `archived_at` datetime;--> statement-breakpoint
ALTER TABLE `bookmark_classifications` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `bookmark_classifications` ADD `classification_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN classification_id ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY FIRST;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `created_at` timestamp DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `archived_at` datetime;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD `tag_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN tag_id ELSE NULL END) STORED;--> statement-breakpoint
ALTER TABLE `bookmark_classifications` ADD CONSTRAINT `uniq_active_bookmark_classification` UNIQUE(`bookmark_id_active`,`classification_id_active`);--> statement-breakpoint
ALTER TABLE `bookmark_tags` ADD CONSTRAINT `uniq_active_bookmark_tag` UNIQUE(`bookmark_id_active`,`tag_id_active`);
