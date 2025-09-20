/**
 * Express Application Configuration
 *
 * Sets up the main Express application with:
 * - JSON body parsing with size limits
 * - Request logging with Pino
 * - API route handlers
 * - Global error handling middleware
 */
import express from 'express';
import pinoHttp from 'pino-http';
import healthRouter from './routes/health.js';
import classificationsRouter from './routes/classifications.js';
import tagsRouter from './routes/tags.js';
import bookmarksRouter from './routes/bookmarks.js';
import { errorHandler } from './middleware/error.js';
import logger from './logger.js';

const app = express();

// Parse JSON request bodies with a 1MB limit to prevent large payload attacks
app.use(express.json({ limit: '1mb' }));

// Add structured request/response logging using Pino
app.use(pinoHttp({ logger }));

// API Route Handlers
app.use('/health', healthRouter);
app.use('/classifications', classificationsRouter);
app.use('/tags', tagsRouter);
app.use('/bookmarks', bookmarksRouter);

// Global error handling middleware - must be last
app.use(errorHandler);

export default app;
