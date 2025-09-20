/**
 * Database Migration Runner
 *
 * Handles automatic database schema migrations by:
 * - Reading SQL migration files from the migrations directory
 * - Tracking applied migrations in a migrations table
 * - Running pending migrations in alphabetical order
 * - Supporting multiple statements per migration file
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, './migrations');

/**
 * Create a direct database connection for migrations
 * Uses multipleStatements: true to allow executing complex SQL files
 */
async function getConnection() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bookmarks',
    multipleStatements: true,  // Required for migration files with multiple statements
  });
  return conn;
}

/**
 * Ensure the migrations tracking table exists
 * This table keeps track of which migrations have been applied
 */
async function ensureMigrationsTable(conn) {
  await conn.execute(`CREATE TABLE IF NOT EXISTS migrations (\n    id VARCHAR(255) PRIMARY KEY,\n    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

/**
 * Extract migration ID from filename
 * Migration files should be named like: 001_description.sql
 * This extracts the numeric prefix as the unique identifier
 */
function idFromFilename(filename) {
  return filename.split('_')[0];
}

/**
 * Main migration runner function
 * Processes all .sql files in the migrations directory
 */
async function run() {
  let conn;
  try {
    conn = await getConnection();
    await ensureMigrationsTable(conn);

    // Get all migration files and sort them alphabetically
    const files = (await fs.readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Get list of already applied migrations
    const [rows] = await conn.execute('SELECT id FROM migrations');
    const applied = new Set(rows.map(r => r.id));

    // Process each migration file
    for (const file of files) {
      const id = idFromFilename(file);
      if (applied.has(id)) continue; // Skip already applied migrations

      const full = path.join(migrationsDir, file);
      const sql = await fs.readFile(full, 'utf8');
      console.log(`Applying migration ${file}...`);
      await conn.query(sql);
      await conn.execute('INSERT INTO migrations (id) VALUES (?)', [id]);
      console.log(`Applied ${file}`);
    }

    console.log('Migrations complete.');
  } finally {
    if (conn) await conn.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
