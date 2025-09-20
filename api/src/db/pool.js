/**
 * Database Connection Pool Configuration
 *
 * Creates a MySQL2 connection pool for MariaDB with:
 * - Environment-based configuration
 * - Connection pooling for performance
 * - Security settings to prevent SQL injection
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Database connection configuration
 * All values can be overridden via environment variables
 */
const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bookmarks',

  // Connection pool settings for optimal performance
  waitForConnections: true,    // Queue requests when pool is full
  connectionLimit: 10,         // Maximum concurrent connections
  queueLimit: 0,              // No limit on queued connection requests

  // Security: Disable multiple statements to prevent SQL injection
  multipleStatements: false,
};

/**
 * Shared database connection pool
 * Used throughout the application for all database operations
 */
export const pool = mysql.createPool(config);
