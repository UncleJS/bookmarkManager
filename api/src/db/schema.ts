import {
  mysqlTable,
  int,
  varchar,
  text,
  tinyint,
  timestamp,
  datetime,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------
export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  order: int("order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  archivedAt: datetime("archived_at"),
});

// ---------------------------------------------------------------------------
// subcategories
// ---------------------------------------------------------------------------
export const subcategories = mysqlTable(
  "subcategories",
  {
    id: int("id").autoincrement().primaryKey(),
    categoryId: int("category_id"),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    order: int("order").default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    archivedAt: datetime("archived_at"),
    // Generated column: non-null only when active — enables unique-among-active index
    nameActive: text("name_active").generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN name ELSE NULL END`,
      { mode: "stored" }
    ),
  },
  (t) => [
    // Uniqueness only among active rows (within a category)
    uniqueIndex("uniq_active_category_name").on(t.categoryId, t.nameActive),
  ]
);

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------
export const tags = mysqlTable(
  "tags",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    archivedAt: datetime("archived_at"),
    // Generated column: non-null only when active
    nameActive: varchar("name_active", { length: 255 }).generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN name ELSE NULL END`,
      { mode: "stored" }
    ),
  },
  (t) => [
    // Unique tag names among active rows only
    uniqueIndex("uniq_active_tag_name").on(t.nameActive),
  ]
);

// ---------------------------------------------------------------------------
// bookmarks
// ---------------------------------------------------------------------------
export const bookmarks = mysqlTable(
  "bookmarks",
  {
    id: int("id").autoincrement().primaryKey(),
    url: text("url").notNull(),
    title: varchar("title", { length: 1024 }).notNull(),
    description: text("description"),
    faviconUrl: text("favicon_url"),
    readLater: tinyint("read_later").default(0),
    hotTopic: tinyint("hot_topic").default(0),
    cheatsheets: tinyint("cheatsheets").default(0),
    forReview: tinyint("for_review").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
    archivedAt: datetime("archived_at"),
    urlHashActive: varchar("url_hash_active", { length: 64 }).generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN SHA2(url, 256) ELSE NULL END`,
      { mode: "stored" }
    ),
  },
  (t) => [
    uniqueIndex("uniq_active_bookmark_url").on(t.urlHashActive),
  ]
);

// ---------------------------------------------------------------------------
// bookmark_tags  (many-to-many)
// ---------------------------------------------------------------------------
export const bookmarkTags = mysqlTable(
  "bookmark_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    bookmarkId: int("bookmark_id").notNull().references(() => bookmarks.id),
    tagId: int("tag_id").notNull().references(() => tags.id),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    archivedAt: datetime("archived_at"),
    bookmarkIdActive: int("bookmark_id_active").generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END`,
      { mode: "stored" }
    ),
    tagIdActive: int("tag_id_active").generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN tag_id ELSE NULL END`,
      { mode: "stored" }
    ),
  },
  (t) => [
    uniqueIndex("uniq_active_bookmark_tag").on(t.bookmarkIdActive, t.tagIdActive),
    index("idx_bt_bookmark").on(t.bookmarkId),
    index("idx_bt_tag").on(t.tagId),
  ]
);

// ---------------------------------------------------------------------------
// bookmark_subcategories  (many-to-many)
// ---------------------------------------------------------------------------
export const bookmarkSubcategories = mysqlTable(
  "bookmark_subcategories",
  {
    id: int("id").autoincrement().primaryKey(),
    bookmarkId: int("bookmark_id").notNull().references(() => bookmarks.id),
    subcategoryId: int("subcategory_id").notNull().references(() => subcategories.id),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    archivedAt: datetime("archived_at"),
    bookmarkIdActive: int("bookmark_id_active").generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN bookmark_id ELSE NULL END`,
      { mode: "stored" }
    ),
    subcategoryIdActive: int("subcategory_id_active").generatedAlwaysAs(
      sql`CASE WHEN archived_at IS NULL THEN subcategory_id ELSE NULL END`,
      { mode: "stored" }
    ),
  },
  (t) => [
    uniqueIndex("uniq_active_bookmark_subcategory").on(t.bookmarkIdActive, t.subcategoryIdActive),
    index("idx_bc_bookmark").on(t.bookmarkId),
    index("idx_bs_subcategory").on(t.subcategoryId),
  ]
);
