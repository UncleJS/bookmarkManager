// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

// Preloaded by bunfig.toml. `bun test` runs every test file in one process and
// shares the module cache, so the app pool in db/client.ts is shared by all
// files. A file must not close it in its own afterAll: any file that runs
// later (the order depends on the file system) would get "Pool is closed"
// and every DB-backed route would answer 500. Close it once, here, at the end.
import { afterAll } from "bun:test";

afterAll(async () => {
  const { pool } = await import("../db/client.ts");
  await pool.end();
});
