/**
 * Health Check Route Handler
 *
 * Provides a simple health check endpoint for monitoring and load balancers.
 * This endpoint can be used to verify that the API is running and responding
 * to requests.
 *
 * Routes:
 * - GET /health - Returns basic status information
 */
import { Router } from 'express';

const router = Router();

/**
 * Health Check Endpoint
 *
 * Returns a simple JSON response indicating the API is operational.
 * This is commonly used by:
 * - Load balancers for health checks
 * - Monitoring systems for uptime verification
 * - Docker/Kubernetes readiness probes
 *
 * @route GET /health
 * @returns {Object} JSON response with status indicator
 */
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;
