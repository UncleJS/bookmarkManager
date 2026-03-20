CREATE TABLE `sub_subcategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subcategory_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`order` int DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	`name_active` text GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED,
	CONSTRAINT `sub_subcategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_subcategory_child_name` UNIQUE(`subcategory_id`,`name_active`)
);--> statement-breakpoint
CREATE INDEX `idx_ssc_subcategory` ON `sub_subcategories` (`subcategory_id`);--> statement-breakpoint
ALTER TABLE `sub_subcategories` ADD CONSTRAINT `fk_ssc_subcategory` FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE `bookmark_sub_subcategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookmark_id` int NOT NULL,
	`sub_subcategory_id` int NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	`bookmark_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END) STORED,
	`sub_subcategory_id_active` int GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN sub_subcategory_id ELSE NULL END) STORED,
	CONSTRAINT `bookmark_sub_subcategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_bookmark_sub_subcategory` UNIQUE(`bookmark_id_active`,`sub_subcategory_id_active`)
);--> statement-breakpoint
CREATE INDEX `idx_bssc_bookmark` ON `bookmark_sub_subcategories` (`bookmark_id`);--> statement-breakpoint
CREATE INDEX `idx_bssc_sub_subcategory` ON `bookmark_sub_subcategories` (`sub_subcategory_id`);--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` ADD CONSTRAINT `fk_bssc_bookmark` FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bookmark_sub_subcategories` ADD CONSTRAINT `fk_bssc_sub_subcategory` FOREIGN KEY (`sub_subcategory_id`) REFERENCES `sub_subcategories`(`id`) ON DELETE no action ON UPDATE no action;
