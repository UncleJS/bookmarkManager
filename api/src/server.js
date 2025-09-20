/**
 * Server Startup and Configuration
 *
 * Initializes the HTTP server with:
 * - Environment configuration loading
 * - Graceful shutdown handling
 * - Port configuration with fallback
 * - Signal handling for clean process termination
 */
import dotenv from 'dotenv';
import app from './app.js';
import logger from './logger.js';

// Load environment variables from .env file
dotenv.config();

// Configure server port from environment or default to 3000
const PORT = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;

// Start the HTTP server
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API listening');
});

/**
 * Graceful shutdown handler
 * Ensures clean termination of the server and any open connections
 *
 * @param {string} sig - The signal that triggered shutdown (SIGINT/SIGTERM)
 */
function shutdown(sig) {
  logger.info({ sig }, 'Shutting down...');

  // Close server and allow existing connections to finish
  server.close(() => process.exit(0));

  // Failsafe timeout to force exit if shutdown hangs
  setTimeout(() => process.exit(1), 10000).unref();
}

// Handle termination signals gracefully
process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker/PM2 shutdown
