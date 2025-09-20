/**
 * Application Logger Configuration
 *
 * Configures Pino logger with environment-specific settings:
 * - Development: Pretty-printed, colorized logs for readability
 * - Production: Structured JSON logs for log aggregation systems
 * - Configurable log levels via environment variables
 */
import pino from 'pino';

// Get log level from environment or default to 'info'
const level = process.env.LOG_LEVEL || 'info';
const isProd = process.env.NODE_ENV === 'production';

/**
 * Create logger instance with environment-specific configuration
 *
 * Development mode:
 * - Uses pino-pretty transport for human-readable output
 * - Includes colorization and timestamp formatting
 * - Excludes process ID and hostname for cleaner output
 *
 * Production mode:
 * - Outputs structured JSON for log aggregation systems
 * - Includes all metadata for debugging and monitoring
 */
const logger = pino({
  level,
  ...(isProd
    ? {} // Production: Use default JSON output
    : {
        // Development: Use pretty-printed transport
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true, // Add colors for different log levels
            translateTime: 'SYS:standard', // Human-readable timestamps
            ignore: 'pid,hostname', // Skip noisy fields in dev
          },
        },
      }),
});

export default logger;
