-- 000_initial_schema.sql
-- Consolidated initial migration containing the complete schema
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Classification groups table
CREATE TABLE IF NOT EXISTS classification_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  `order` INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Classifications table
CREATE TABLE IF NOT EXISTS classifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NULL,
  name VARCHAR(255) NOT NULL,
  `order` INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_group_name (group_id, name),
  CONSTRAINT fk_class_group FOREIGN KEY (group_id) REFERENCES classification_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bookmarks table (without classification_id and url_hash, with for_review flag)
CREATE TABLE IF NOT EXISTS bookmarks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  url TEXT NOT NULL,
  title VARCHAR(1024) NOT NULL,
  description TEXT NULL,
  favicon_url TEXT NULL,
  read_later TINYINT(1) DEFAULT 0,
  hot_topic TINYINT(1) DEFAULT 0,
  cheatsheets TINYINT(1) DEFAULT 0,
  archived TINYINT(1) DEFAULT 0,
  for_review TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Junction table for many-to-many relationship between bookmarks and tags
CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (bookmark_id, tag_id),
  CONSTRAINT fk_bt_bookmark FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  CONSTRAINT fk_bt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Junction table for many-to-many relationship between bookmarks and classifications
CREATE TABLE IF NOT EXISTS bookmark_classifications (
  bookmark_id INT NOT NULL,
  classification_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bookmark_id, classification_id),
  CONSTRAINT fk_bc_bookmark FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  CONSTRAINT fk_bc_classification FOREIGN KEY (classification_id) REFERENCES classifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bc_bookmark ON bookmark_classifications(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_bc_classification ON bookmark_classifications(classification_id);
