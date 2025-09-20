/**
 * Error Handling Middleware
 *
 * Provides centralized error handling for the Express application with:
 * - Consistent error response format
 * - Environment-specific error details
 * - Request logging integration
 * - HTTP status code handling
 */

/**
 * Global error handler middleware
 *
 * This middleware catches all errors thrown in route handlers and provides
 * a consistent JSON error response format. Must be registered last in the
 * middleware chain to catch all errors.
 *
 * @param {Error} err - The error object
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Next middleware function
 */
export function errorHandler(err, req, res, next) {
  // Extract HTTP status code from error or default to 500
  const status = err.status || 500;

  // Create base error response payload
  const payload = { error: err.message || 'Internal Server Error' };

  // In development, include additional error details for debugging
  if (process.env.NODE_ENV !== 'production' && err.details) {
    payload.details = err.details;
  }

  // Log the error with request context if logger is available
  req.log?.error({ err }, 'Request error');

  // Send JSON error response
  res.status(status).json(payload);
}

/**
 * Create HTTP Error Helper
 *
 * Utility function to create standardized HTTP errors with status codes
 * and optional additional details for debugging.
 *
 * @param {number} status - HTTP status code
 * @param {string} message - Error message for the response
 * @param {any} details - Optional additional error details (dev only)
 * @returns {Error} Formatted error object with status property
 */
export function createHttpError(status, message, details) {
  const e = new Error(message);
  e.status = status;
  if (details) e.details = details;
  return e;
}
