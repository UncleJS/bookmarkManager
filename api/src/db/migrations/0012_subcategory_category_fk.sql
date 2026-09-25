UPDATE `subcategories`
SET `category_id` = NULL
WHERE `category_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `categories` WHERE `categories`.`id` = `subcategories`.`category_id`
  );--> statement-breakpoint
ALTER TABLE `subcategories` ADD CONSTRAINT `subcategories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;
