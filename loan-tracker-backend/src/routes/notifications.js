import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// List notifications for the current user
router.get("/", async (req, res) => {
  try {
    const { limit = 20, only_unread = "false" } = req.query;
    let queryText = `SELECT * FROM notifications WHERE user_id = $1`;
    if (only_unread === "true") queryText += ` AND is_read = FALSE`;
    queryText += ` ORDER BY created_at DESC LIMIT $2`;

    const result = await query(queryText, [
      req.user.id,
      Math.min(parseInt(limit, 10) || 20, 200),
    ]);
    const countResult = await query(
      `SELECT COUNT(*) AS unread FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id],
    );

    res.json({
      success: true,
      data: result.rows,
      unread_count: parseInt(countResult.rows[0].unread, 10),
    });
  } catch (error) {
    logger.error("Get notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Lightweight unread count (polled every 30s by the bell)
router.get("/unread-count", async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id],
    );
    res.json({
      success: true,
      unread_count: parseInt(result.rows[0].count, 10),
    });
  } catch (error) {
    logger.error("Unread count error:", error);
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

// Mark all as read
router.put("/mark-all-read", async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE RETURNING id`,
      [req.user.id],
    );
    res.json({ success: true, marked_count: result.rows.length });
  } catch (error) {
    logger.error("Mark all read error:", error);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// Clear old read notifications — declared BEFORE "/:id" so the
// literal path isn't captured as an :id (it would 500 trying to
// cast "clear-old" to an integer).
router.delete("/clear-old", async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM notifications
       WHERE user_id = $1 AND is_read = TRUE
         AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`,
      [req.user.id],
    );
    res.json({ success: true, deleted_count: result.rows.length });
  } catch (error) {
    logger.error("Clear old notifications error:", error);
    res.status(500).json({ error: "Failed to clear old notifications" });
  }
});

// Mark one as read
router.put("/:id/read", async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    res.json({ success: true });
  } catch (error) {
    logger.error("Mark read error:", error);
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// Delete one
router.delete("/:id", async (req, res) => {
  try {
    await query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    );
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete notification error:", error);
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
