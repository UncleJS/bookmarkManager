/**
 * Tags Route Handler
 *
 * Handles tag management operations including:
 * - Retrieving tags with search and pagination support
 * - Creating new tags with duplicate detection
 * - Autocomplete functionality for the Chrome extension
 */
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { createHttpError } from '../middleware/error.js';

const router = Router();

/**
 * Get Tags Endpoint
 *
 * Returns tags with optional search filtering and pagination.
 * Supports autocomplete functionality by allowing partial name matching.
 *
 * @route GET /tags
 * @param {string} [query.query] - Optional search term for tag name filtering
 * @param {number} [query.limit] - Maximum number of results (default: 20, max: 100)
 * @param {number} [query.offset] - Number of results to skip for pagination (default: 0)
 * @returns {Object} JSON object with items array and total count
 */
router.get('/', async (req, res, next) => {
  try {
    // Parse and validate query parameters
    const q = String(req.query.query || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // Build dynamic WHERE clause for search functionality
    let where = '';
    const params = [];
    if (q) {
      where = 'WHERE name LIKE ?';
      params.push(`%${q}%`); // Partial matching for autocomplete
    }

    // Execute query with pagination and get total count
    const [rows] = await pool.query(
      `SELECT SQL_CALC_FOUND_ROWS id, name FROM tags ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count for pagination metadata
    const [totalRows] = await pool.query('SELECT FOUND_ROWS() AS total');
    const total = totalRows[0].total;

    res.json({ items: rows, total });
  } catch (err) {
    next(err);
  }
});

/**
 * Create Tag Endpoint
 *
 * Creates a new tag with the specified name.
 * Prevents duplicate tags through database constraints.
 *
 * @route POST /tags
 * @param {Object} body - Request body containing tag data
 * @param {string} body.name - Required tag name
 * @returns {Object} Created tag with ID and name
 */
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body || {};

    // Validate required fields
    if (!name || typeof name !== 'string') {
      throw createHttpError(400, 'name is required');
    }

    // Clean and validate tag name
    const clean = name.trim();
    if (!clean) throw createHttpError(400, 'name cannot be empty');

    try {
      // Insert new tag
      const [result] = await pool.execute('INSERT INTO tags (name) VALUES (?)', [clean]);
      res.status(201).json({ id: result.insertId, name: clean });
    } catch (e) {
      // Handle duplicate tag constraint violation
      if (e && e.code === 'ER_DUP_ENTRY') {
        return next(createHttpError(409, 'Tag already exists'));
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

export default router;
