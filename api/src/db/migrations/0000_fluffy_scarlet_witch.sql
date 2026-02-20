CREATE TABLE `bookmark_classifications` (
	`bookmark_id` int NOT NULL,
	`classification_id` int NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bookmark_classifications_bookmark_id_classification_id_pk` PRIMARY KEY(`bookmark_id`,`classification_id`)
);
--> statement-breakpoint
CREATE TABLE `bookmark_tags` (
	`bookmark_id` int NOT NULL,
	`tag_id` int NOT NULL,
	CONSTRAINT `bookmark_tags_bookmark_id_tag_id_pk` PRIMARY KEY(`bookmark_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` text NOT NULL,
	`title` varchar(1024) NOT NULL,
	`description` text,
	`favicon_url` text,
	`read_later` tinyint DEFAULT 0,
	`hot_topic` tinyint DEFAULT 0,
	`cheatsheets` tinyint DEFAULT 0,
	`for_review` tinyint NOT NULL DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	CONSTRAINT `bookmarks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `classification_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`order` int DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	CONSTRAINT `classification_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `classifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`group_id` int,
	`name` varchar(255) NOT NULL,
	`order` int DEFAULT 0,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	`name_active` text GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED,
	CONSTRAINT `classifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_group_name` UNIQUE(`group_id`,`name_active`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`archived_at` datetime,
	`name_active` varchar(255) GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_tag_name` UNIQUE(`name_active`)
);
--> statement-breakpoint
CREATE INDEX `idx_bc_bookmark` ON `bookmark_classifications` (`bookmark_id`);--> statement-breakpoint
CREATE INDEX `idx_bc_classification` ON `bookmark_classifications` (`classification_id`);--> statement-breakpoint
CREATE INDEX `idx_bt_bookmark` ON `bookmark_tags` (`bookmark_id`);--> statement-breakpoint
CREATE INDEX `idx_bt_tag` ON `bookmark_tags` (`tag_id`);