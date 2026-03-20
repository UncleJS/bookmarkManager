CREATE TABLE `bookmark_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookmark_id` int NOT NULL,
	`category_id` int NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	`bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END) STORED,
	`category_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN category_id ELSE NULL END) STORED,
	CONSTRAINT `bookmark_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_bookmark_category` UNIQUE(`bookmark_id_active`,`category_id_active`)
);--> statement-breakpoint
CREATE INDEX `idx_bcat_bookmark` ON `bookmark_categories` (`bookmark_id`);--> statement-breakpoint
CREATE INDEX `idx_bcat_category` ON `bookmark_categories` (`category_id`);--> statement-breakpoint
ALTER TABLE `bookmark_categories` ADD CONSTRAINT `fk_bcat_bookmark` FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookmark_categories` ADD CONSTRAINT `fk_bcat_category` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;
