// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.ts";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: requiredEnv("DB_USER"),
  password: requiredEnv("DB_PASSWORD"),
  database: process.env.DB_NAME ?? "bookmarks",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false,
  // How mysql2 converts DATETIME values to/from JS Dates: as UTC.
  timezone: "+00:00",
});

// Every *_UTC column holds UTC. Pin the session time zone on each new
// connection so UTC_TIMESTAMP()/date functions never depend on the server or
// container zone. The connection runs this before any query handed to it.
export const SESSION_TIME_ZONE = "+00:00";
pool.pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${SESSION_TIME_ZONE}'`, (error) => {
    if (!error) return;
    // Never hand out a connection in the wrong zone: drop it so the pool
    // opens a new one and the query that was waiting on it fails loudly.
    console.error("Failed to set the DB session time zone:", error.message);
    connection.destroy();
  });
});

export const db = drizzle(pool, { schema, mode: "default" });
export { pool };
