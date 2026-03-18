import { t } from "elysia";
import type { AnyColumn } from "drizzle-orm";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { bookmarks } from "../db/schema.ts";

export const S = {
  str: (description: string) => ({ type: "string" as const, description }),
  num: (description: string) => ({ type: "number" as const, description }),
  bool: (description: string) => ({ type: "boolean" as const, description }),
  any: (description: string) => ({ description }),
  nullable: (schema: object) => ({ anyOf: [schema, { type: "null" as const }] }),
  obj: (description: string, properties: Record<string, object>, required?: string[]) =>
    ({ type: "object" as const, description, properties, ...(required ? { required } : {}) }),
  arr: (description: string, items: object) =>
    ({ type: "array" as const, description, items }),
};

export const ErrorResp = {
  description: "Error",
  content: { "application/json": { schema: {
    type: "object" as const,
    properties: { error: { type: "string" as const, description: "Human-readable error message" } },
    required: ["error"],
  } } },
};

export const OkResp = {
  description: "Success",
  content: { "application/json": { schema: {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const, enum: [true], description: "Always true on success" } },
    required: ["ok"],
  } } },
};

export const BOOKMARK_FLAG_VALUES = ["readLater", "hotTopic", "cheatsheets", "forReview"] as const;
export const BOOKMARK_SORT_VALUES = ["newest", "oldest"] as const;

export const PositiveIdParam = t.Object({
  id: t.Number({
    minimum: 1,
    multipleOf: 1,
    description: "Positive integer ID.",
    error: "id must be a positive integer",
  }),
});

export function getValidationErrorMessage(error: {
  all?: Array<{ message?: string }>;
  customError?: unknown;
  message: string;
}) {
  return (typeof error.customError === "string" ? error.customError : undefined)
    ?? error.message
    ?? error.all?.find((entry) => entry.message)?.message
    ?? "Validation error";
}

export function isDupEntry(err: unknown): boolean {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? err.code
      : typeof err === "object" && err !== null && "cause" in err && typeof err.cause === "object" && err.cause !== null && "code" in err.cause
        ? err.cause.code
        : undefined;

  return code === "ER_DUP_ENTRY";
}

export async function findActiveBookmarksByUrl(url: string) {
  return db
    .select({
      id: bookmarks.id,
      url: bookmarks.url,
      title: bookmarks.title,
      createdAt: bookmarks.createdAt,
    })
    .from(bookmarks)
    .where(and(
      sql`url = ${url}`,
      isNull(bookmarks.archivedAt)
    ));
}

export function duplicateUrlResponse(duplicates: Array<{
  id: number;
  url: string;
  title: string;
  createdAt: Date | null;
}>) {
  return {
    error: "Duplicate URL",
    duplicates: duplicates.map((bookmark) => ({
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      createdAt: bookmark.createdAt,
    })),
  };
}

export type BookmarkFlagColumnMap = Record<string, AnyColumn>;
