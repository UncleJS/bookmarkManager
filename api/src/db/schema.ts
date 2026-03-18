import {
  mysqlTable,
  int,
  varchar,
  text,
  tinyint,
  timestamp,
  datetime,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// classification_groups
// ---------------------------------------------------------------------------
export const classificationGroups = mysqlTable("classification_groups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  order: int("order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  archivedAt: datetime("archived_at"),
});

// ---------------------------------------------------------------------------
// classifications
// ---------------------------------------------------------------------------
export const classifications = mysqlTable(
  "classifications",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("group_id"),
    name: varchar("name", { length: 255 }).notNull(),
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
    // Uniqueness only among active rows (within a group)
    uniqueIndex("uniq_active_group_name").on(t.groupId, t.nameActive),
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
export const bookmarks = mysqlTable("bookmarks", {
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
});

// ---------------------------------------------------------------------------
// bookmark_tags  (many-to-many)
// ---------------------------------------------------------------------------
export const bookmarkTags = mysqlTable(
  "bookmark_tags",
  {
    bookmarkId: int("bookmark_id").notNull(),
    tagId: int("tag_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bookmarkId, t.tagId] }),
    index("idx_bt_bookmark").on(t.bookmarkId),
    index("idx_bt_tag").on(t.tagId),
  ]
);

// ---------------------------------------------------------------------------
// bookmark_classifications  (many-to-many)
// ---------------------------------------------------------------------------
export const bookmarkClassifications = mysqlTable(
  "bookmark_classifications",
  {
    bookmarkId: int("bookmark_id").notNull(),
    classificationId: int("classification_id").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    primaryKey({ columns: [t.bookmarkId, t.classificationId] }),
    index("idx_bc_bookmark").on(t.bookmarkId),
    index("idx_bc_classification").on(t.classificationId),
  ]
);
