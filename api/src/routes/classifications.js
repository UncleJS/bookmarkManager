/**
 * Classifications Route Handler
 *
 * Handles classification management operations including:
 * - Retrieving all classifications grouped by category
 * - Creating new classifications with optional group creation
 * - Hierarchical organization of classifications
 */
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { createHttpError } from '../middleware/error.js';

const router = Router();

/**
 * Get All Classifications Endpoint
 *
 * Returns all classifications organized by their groups in a hierarchical structure.
 * This is used by the Chrome extension to populate classification dropdowns.
 *
 * @route GET /classifications
 * @returns {Object} JSON object with groups array containing classifications
 */
router.get('/', async (req, res, next) => {
  try {
    // Fetch all classification groups ordered by priority then name
    const [groups] = await pool.query('SELECT id, name, `order` FROM classification_groups ORDER BY `order`, name');

    // Fetch all classifications with their group associations
    const [classes] = await pool.query('SELECT id, group_id AS groupId, name, `order` FROM classifications ORDER BY `order`, name');

    // Build hierarchical structure: groups with their classifications
    const byGroup = new Map(groups.map(g => [g.id, { id: g.id, name: g.name, order: g.order, classifications: [] }]));

    // Associate each classification with its group
    for (const c of classes) {
      const g = byGroup.get(c.groupId);
      if (g) g.classifications.push({ id: c.id, name: c.name, order: c.order });
    }

    res.json({ groups: Array.from(byGroup.values()) });
  } catch (err) {
    next(err);
  }
});

/**
 * Create Classification Endpoint
 *
 * Creates a new classification, optionally creating a new group if specified.
 * Supports creating classifications with or without group association.
 *
 * @route POST /classifications
 * @param {Object} body - Request body containing classification data
 * @param {string} body.name - Required classification name
 * @param {number} [body.groupId] - Optional existing group ID
 * @param {string} [body.groupName] - Optional new group name (creates group if provided)
 * @returns {Object} Created classification with ID and metadata
 */
router.post('/', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { name, groupId, groupName } = req.body || {};

    // Validate required fields
    if (!name || typeof name !== 'string') throw createHttpError(400, 'name is required');

    // Start database transaction for atomic operation
    await conn.beginTransaction();

    // Determine or create the group ID
    let gId = groupId || null;
    if (!gId && groupName && typeof groupName === 'string') {
      const cleanG = groupName.trim();
      if (!cleanG) throw createHttpError(400, 'groupName cannot be empty');

      // Create new classification group
      const [r] = await conn.execute('INSERT INTO classification_groups (name) VALUES (?)', [cleanG]);
      gId = r.insertId;
    }

    // Clean and validate classification name
    const cleanName = name.trim();
    if (!cleanName) throw createHttpError(400, 'name cannot be empty');

    // Create the classification
    const [r2] = await conn.execute('INSERT INTO classifications (group_id, name) VALUES (?, ?)', [gId, cleanName]);

    // Commit transaction - all operations succeeded
    await conn.commit();

    res.status(201).json({ id: r2.insertId, name: cleanName, groupId: gId || null });
  } catch (err) {
    // Rollback transaction on any error
    await conn.rollback();

    // Handle specific database constraint violations
    if (err && err.code === 'ER_DUP_ENTRY') {
      return next(createHttpError(409, 'Classification already exists'));
    }
    next(err);
  } finally {
    // Always release connection back to pool
    conn.release();
  }
});

export default router;
