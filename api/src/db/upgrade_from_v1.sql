-- =============================================================================
-- upgrade_from_v1.sql
-- One-time migration for databases created with the original Express/plain-SQL
-- schema (000_initial_schema.sql). Run this ONCE on an existing database before
-- switching to Drizzle-managed migrations.
--
-- What this does:
--   1. Adds archived_at columns to all user-facing tables.
--   2. Populates archived_at for rows where the old archived TINYINT = 1.
--   3. Adds the generated name_active columns (unique-among-active pattern).
--   4. Drops the old archived TINYINT column from bookmarks.
--   5. Creates the drizzle __drizzle_migrations table so drizzle-kit migrate
--      knows the 0000 baseline has already been applied (skips it).
--
-- After running this script, run: bun run db:migrate
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- 1. Add archived_at to categories
-- ---------------------------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- 2. Add archived_at to subcategories
-- ---------------------------------------------------------------------------
ALTER TABLE subcategories
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL;

-- Add generated column for unique-among-active index
ALTER TABLE subcategories
  ADD COLUMN IF NOT EXISTS name_active TEXT GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN name ELSE NULL END
  ) STORED;

-- Drop old unique constraint (category_id, name) — replace with (category_id, name_active)
ALTER TABLE subcategories
  DROP INDEX IF EXISTS uniq_category_name;

-- Add new unique-among-active index (allows archived duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_category_name
  ON subcategories (category_id, name_active);

-- ---------------------------------------------------------------------------
-- 3. Add archived_at to tags + generated column
-- ---------------------------------------------------------------------------
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS name_active VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN name ELSE NULL END
  ) STORED;

-- Drop old unique constraint on name — replace with unique on name_active
ALTER TABLE tags
  DROP INDEX IF EXISTS uniq_tag_name;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_tag_name
  ON tags (name_active);

-- ---------------------------------------------------------------------------
-- 4. Add archived_at to bookmarks
--    Migrate old archived=1 rows to archived_at = created_at (best approx.)
-- ---------------------------------------------------------------------------
ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL;

ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS url_hash_active VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN SHA2(url, 256) ELSE NULL END
  ) STORED;

UPDATE bookmarks
  SET archived_at = created_at
  WHERE archived = 1 AND archived_at IS NULL;

-- Drop the old archived TINYINT column (now superseded by archived_at)
ALTER TABLE bookmarks
  DROP COLUMN IF EXISTS archived;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_bookmark_url
  ON bookmarks (url_hash_active);

-- ---------------------------------------------------------------------------
-- 5. Add archive lifecycle columns to junction tables
-- ---------------------------------------------------------------------------
ALTER TABLE bookmark_tags
  DROP PRIMARY KEY,
  ADD COLUMN IF NOT EXISTS id INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bookmark_id_active INT GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END
  ) STORED,
  ADD COLUMN IF NOT EXISTS tag_id_active INT GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN tag_id ELSE NULL END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_bookmark_tag
  ON bookmark_tags (bookmark_id_active, tag_id_active);

ALTER TABLE bookmark_subcategories
  DROP PRIMARY KEY,
  ADD COLUMN IF NOT EXISTS id INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bookmark_id_active INT GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END
  ) STORED,
  ADD COLUMN IF NOT EXISTS subcategory_id_active INT GENERATED ALWAYS AS (
    CASE WHEN archived_at IS NULL THEN subcategory_id ELSE NULL END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_bookmark_subcategory
  ON bookmark_subcategories (bookmark_id_active, subcategory_id_active);

SET @fk_bc_bookmark_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookmark_subcategories'
    AND CONSTRAINT_NAME = 'bookmark_subcategories_bookmark_id_bookmarks_id_fk'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_bc_bookmark_sql := IF(
  @fk_bc_bookmark_exists = 0,
  'ALTER TABLE bookmark_subcategories ADD CONSTRAINT bookmark_subcategories_bookmark_id_bookmarks_id_fk FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE NO ACTION ON UPDATE NO ACTION',
  'SELECT 1'
);
PREPARE stmt FROM @fk_bc_bookmark_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_bc_subcategory_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookmark_subcategories'
    AND CONSTRAINT_NAME = 'bookmark_subcategories_subcategory_id_subcategories_id_fk'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_bc_subcategory_sql := IF(
  @fk_bc_subcategory_exists = 0,
  'ALTER TABLE bookmark_subcategories ADD CONSTRAINT bookmark_subcategories_subcategory_id_subcategories_id_fk FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE NO ACTION ON UPDATE NO ACTION',
  'SELECT 1'
);
PREPARE stmt FROM @fk_bc_subcategory_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_bt_bookmark_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookmark_tags'
    AND CONSTRAINT_NAME = 'bookmark_tags_bookmark_id_bookmarks_id_fk'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_bt_bookmark_sql := IF(
  @fk_bt_bookmark_exists = 0,
  'ALTER TABLE bookmark_tags ADD CONSTRAINT bookmark_tags_bookmark_id_bookmarks_id_fk FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE NO ACTION ON UPDATE NO ACTION',
  'SELECT 1'
);
PREPARE stmt FROM @fk_bt_bookmark_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_bt_tag_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookmark_tags'
    AND CONSTRAINT_NAME = 'bookmark_tags_tag_id_tags_id_fk'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_bt_tag_sql := IF(
  @fk_bt_tag_exists = 0,
  'ALTER TABLE bookmark_tags ADD CONSTRAINT bookmark_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE NO ACTION ON UPDATE NO ACTION',
  'SELECT 1'
);
PREPARE stmt FROM @fk_bt_tag_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 6. Register the Drizzle 0000 baseline as already applied
--    This prevents drizzle-kit from trying to re-run the fresh-install migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hash VARCHAR(255) NOT NULL,
  created_at BIGINT
);

-- Insert the 0000 migration hash so drizzle-kit skips it.
-- The hash must match what drizzle-kit generated in meta/_journal.json.
-- Run: cat api/src/db/migrations/meta/_journal.json   to verify the tag value.
INSERT IGNORE INTO `__drizzle_migrations` (hash, created_at)
  SELECT '0000_fluffy_scarlet_witch', UNIX_TIMESTAMP() * 1000
  WHERE NOT EXISTS (SELECT 1 FROM `__drizzle_migrations` WHERE hash = '0000_fluffy_scarlet_witch');
