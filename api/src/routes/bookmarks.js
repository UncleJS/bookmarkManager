/**
 * Bookmarks Route Handler
 *
 * Handles bookmark management operations including:
 * - Creating new bookmarks with metadata
 * - Associating bookmarks with tags and classifications
 * - Managing bookmark flags (read_later, hot_topic, etc.)
 * - Database transaction handling for data consistency
 */
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { createHttpError } from '../middleware/error.js';

const router = Router();

/**
 * Create Bookmark Endpoint
 *
 * Creates a new bookmark with associated tags and classifications.
 * Uses database transactions to ensure data consistency across
 * multiple table operations.
 *
 * @route POST /bookmarks
 * @param {Object} body - Request body containing bookmark data
 * @param {string} body.url - Required bookmark URL
 * @param {string} body.title - Required bookmark title
 * @param {string} [body.description] - Optional description
 * @param {number[]} [body.classificationIds] - Array of classification IDs
 * @param {number[]} [body.tags] - Array of tag IDs
 * @param {Object} [body.flags] - Boolean flags for bookmark properties
 * @param {string} [body.faviconUrl] - Optional favicon URL
 * @returns {Object} Created bookmark with ID and metadata
 */
router.post('/', async (req, res, next) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const body = req.body || {};
    const { url, title, description, classificationIds, tags, flags, faviconUrl, allowDuplicate } = body;

    // Validate required fields
    if (!url || typeof url !== 'string') throw createHttpError(400, 'url is required');
    if (!title || typeof title !== 'string') throw createHttpError(400, 'title is required');

    // Clean and validate input data
    const cleanUrl = url.trim();
    const cleanTitle = title.trim();
    if (!cleanUrl) throw createHttpError(400, 'url cannot be empty');
    if (!cleanTitle) throw createHttpError(400, 'title cannot be empty');

    const duplicatesAllowed = allowDuplicate === true;

    // Check for existing bookmarks with the same URL before starting transaction
    const [existingRows] = await conn.query(
      'SELECT id, url, title, created_at FROM bookmarks WHERE url = ? ORDER BY created_at DESC LIMIT 5',
      [cleanUrl]
    );

    if (!duplicatesAllowed && Array.isArray(existingRows) && existingRows.length > 0) {
      return res.status(409).json({
        error: 'Bookmark already exists for this URL',
        duplicates: existingRows.map(row => ({
          id: row.id,
          url: row.url,
          title: row.title,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        })),
      });
    }

    // Convert flags to database boolean values (0/1)
    const readLater = flags?.readLater ? 1 : 0;
    const hotTopic = flags?.hotTopic ? 1 : 0;
    const cheatsheets = flags?.cheatsheets ? 1 : 0;
    const archived = flags?.archived ? 1 : 0;
    const forReview = flags?.forReview ? 1 : 0;

    // Start database transaction for atomic operation
    await conn.beginTransaction();
    transactionStarted = true;

    // Insert main bookmark record
    const [r] = await conn.execute(
      `INSERT INTO bookmarks (url, title, description, favicon_url, read_later, hot_topic, cheatsheets, archived, for_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cleanUrl, cleanTitle, description || null, faviconUrl || null, readLater, hotTopic, cheatsheets, archived, forReview]
    );

    const bookmarkId = r.insertId;

    // Associate bookmark with classifications if provided
    if (Array.isArray(classificationIds) && classificationIds.length > 0) {
      // Filter and deduplicate classification IDs
      const clsUnique = Array.from(new Set(
        classificationIds
          .map(id => Number(id))
          .filter(n => Number.isInteger(n) && n > 0)
      ));
      if (clsUnique.length > 0) {
        const clsPairs = clsUnique.map(cid => [bookmarkId, cid]);
        await conn.query('INSERT INTO bookmark_classifications (bookmark_id, classification_id) VALUES ?', [clsPairs]);
      }
    }

    // Associate bookmark with tags if provided
    if (Array.isArray(tags) && tags.length > 0) {
      // Filter and deduplicate tag IDs
      const tagUnique = Array.from(new Set(
        tags
          .map(id => Number(id))
          .filter(n => Number.isInteger(n) && n > 0)
      ));
      if (tagUnique.length > 0) {
        const values = tagUnique.map(tid => [bookmarkId, tid]);
        await conn.query('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES ?',[values]);
      }
    }

    // Commit transaction - all operations succeeded
    await conn.commit();
    transactionStarted = false;

    // Return created bookmark information
    res.status(201).json({
      id: bookmarkId,
      url: cleanUrl,
      title: cleanTitle,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    // Rollback transaction on any error
    if (transactionStarted) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback errors
      }
    }

    // Handle specific database constraint violations
    if (err && err.code === 'ER_DUP_ENTRY') {
      return next(createHttpError(409, 'Bookmark already exists for this URL'));
    }
    next(err);
  } finally {
    // Always release connection back to pool
    conn.release();
  }
});

export default router;
