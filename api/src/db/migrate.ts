import { migrate } from "drizzle-orm/mysql2/migrator";
import { db, pool } from "./client.ts";

const RETRY_DELAY_MS = 2000;
const MAX_ATTEMPTS = 15;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    await pool.query("select 1");
    break;
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) {
      throw error;
    }

    await Bun.sleep(RETRY_DELAY_MS);
  }
}

await migrate(db, { migrationsFolder: "src/db/migrations" });
await pool.end();
