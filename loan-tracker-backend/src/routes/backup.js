import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import {
  createBackup,
  restoreBackup,
  cleanupOldBackups,
  getBackupStats,
  BACKUP_DIR_RESOLVED,
} from "../services/backupService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Backups here are whole-DATABASE pg_dumps spanning every tenant — a
// tenant admin must NOT be able to list, download (all tenants' PII +
// password hashes), restore (overwrite every tenant) or upload-restore
// arbitrary SQL. In the shared-DB model this is a PLATFORM operation,
// so it is restricted to platform administrators (stricter than the
// previous authorize("admin"), which any tenant's admin satisfied).
router.use(authorize("admin"));
router.use((req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res.status(403).json({
      error:
        "Database backup & restore is restricted to platform administrators",
    });
  }
  next();
});

const upload = multer({
  dest: BACKUP_DIR_RESOLVED,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".sql")) cb(null, true);
    else cb(new Error("Only .sql files are allowed"));
  },
});

// multer error -> clean 400 (instead of falling through to the
// generic 500 error handler)
const uploadBackup = (req, res, next) =>
  upload.single("backup")(req, res, (err) =>
    err ? res.status(400).json({ error: err.message }) : next(),
  );

const numericId = (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  next();
};

// List backups
router.get("/", async (req, res) => {
  try {
    const result = await query(`
      SELECT b.*, u.first_name, u.last_name, u.email
      FROM backups b
      LEFT JOIN users u ON b.created_by = u.id
      ORDER BY b.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get backups error:", error);
    res.status(500).json({ error: "Failed to fetch backups" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    res.json({ success: true, data: await getBackupStats() });
  } catch (error) {
    logger.error("Backup stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Create a manual backup
router.post("/create", async (req, res) => {
  try {
    const result = await createBackup({
      type: "manual",
      userId: req.user.id,
    });
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    await logAudit({
      user: req.user,
      action: "backup_created",
      entityType: "backup",
      entityId: result.id,
      entityCode: result.filename,
      description: `Created manual backup: ${result.filename} (${result.size_mb} MB)`,
      req,
    });
    res.json({
      success: true,
      message: "Backup created successfully",
      data: result,
    });
  } catch (error) {
    logger.error("Create backup error:", error);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

// Download a backup file
router.get("/:id/download", numericId, async (req, res) => {
  try {
    const result = await query("SELECT * FROM backups WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Backup not found" });
    }
    const backup = result.rows[0];
    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ error: "Backup file not found on disk" });
    }
    await logAudit({
      user: req.user,
      action: "backup_downloaded",
      entityType: "backup",
      entityId: backup.id,
      entityCode: backup.filename,
      description: `Downloaded backup: ${backup.filename}`,
      req,
    });
    res.download(backup.file_path, backup.filename);
  } catch (error) {
    logger.error("Download backup error:", error);
    res.status(500).json({ error: "Failed to download" });
  }
});

// Restore from an existing backup
router.post("/:id/restore", numericId, async (req, res) => {
  try {
    if (req.body.confirm !== "RESTORE") {
      return res.status(400).json({
        error: 'Confirmation required. Send {"confirm":"RESTORE"} in body',
      });
    }
    const result = await query("SELECT * FROM backups WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Backup not found" });
    }
    const backup = result.rows[0];

    await logAudit({
      user: req.user,
      action: "backup_restore_started",
      entityType: "backup",
      entityId: backup.id,
      entityCode: backup.filename,
      description: `Started DB restore from: ${backup.filename}`,
      req,
    });

    const restore = await restoreBackup(backup.file_path, req.user.id);
    if (!restore.success) {
      return res.status(500).json({ error: restore.error });
    }
    // NOTE: the audit_logs table was just replaced by the restore, so
    // this row lands in the *restored* DB (expected for full restore).
    await logAudit({
      user: req.user,
      action: "backup_restored",
      entityType: "backup",
      entityId: backup.id,
      entityCode: backup.filename,
      description: `Restored DB from: ${backup.filename}`,
      req,
    });
    res.json({
      success: true,
      message: "Database restored successfully",
      safety_backup: restore.safety_backup,
    });
  } catch (error) {
    logger.error("Restore error:", error);
    res.status(500).json({ error: "Failed to restore" });
  }
});

// Upload an external .sql and restore from it
router.post("/upload-restore", uploadBackup, async (req, res) => {
  let storedPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (req.body.confirm !== "RESTORE") {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Confirmation required. Send confirm="RESTORE" in form data',
      });
    }

    // Sanitise the client-supplied name (path traversal / shell-meta
    // can't reach a shell anyway since the service uses execFile, but
    // keep the on-disk name safe regardless).
    const base = path
      .basename(req.file.originalname)
      .replace(/[^A-Za-z0-9._-]/g, "_");
    const safeName = `uploaded_${Date.now()}_${base}`;
    storedPath = path.join(BACKUP_DIR_RESOLVED, safeName);
    fs.renameSync(req.file.path, storedPath);

    const stats = fs.statSync(storedPath);
    const rec = await query(
      `INSERT INTO backups (filename, file_path, file_size, backup_type, status, created_by)
       VALUES ($1, $2, $3, 'uploaded', 'success', $4) RETURNING id`,
      [safeName, storedPath, stats.size, req.user.id],
    );

    const restore = await restoreBackup(storedPath, req.user.id);
    if (!restore.success) {
      return res.status(500).json({ error: restore.error });
    }
    await logAudit({
      user: req.user,
      action: "backup_uploaded_restored",
      entityType: "backup",
      entityId: rec.rows[0].id,
      entityCode: safeName,
      description: `Restored from uploaded backup: ${safeName}`,
      req,
    });
    res.json({
      success: true,
      message: "Database restored from uploaded backup",
      safety_backup: restore.safety_backup,
    });
  } catch (error) {
    logger.error("Upload-restore error:", error);
    // best-effort cleanup of the uploaded temp file
    try {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (storedPath && fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
    } catch {
      /* ignore */
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete a backup
router.delete("/:id", numericId, async (req, res) => {
  try {
    const result = await query("SELECT * FROM backups WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Backup not found" });
    }
    const backup = result.rows[0];

    const resolved = path.resolve(backup.file_path);
    if (
      (resolved === BACKUP_DIR_RESOLVED ||
        resolved.startsWith(BACKUP_DIR_RESOLVED + path.sep)) &&
      fs.existsSync(resolved)
    ) {
      fs.unlinkSync(resolved);
    }
    await query("DELETE FROM backups WHERE id = $1", [req.params.id]);

    await logAudit({
      user: req.user,
      action: "backup_deleted",
      entityType: "backup",
      entityId: backup.id,
      entityCode: backup.filename,
      description: `Deleted backup: ${backup.filename}`,
      req,
    });
    res.json({ success: true, message: "Backup deleted successfully" });
  } catch (error) {
    logger.error("Delete backup error:", error);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// Cleanup old backups
router.post("/cleanup", async (req, res) => {
  try {
    const retentionDays = parseInt(req.body.retention_days, 10) || 30;
    const result = await cleanupOldBackups(retentionDays);
    res.json({
      success: true,
      message: `Deleted ${result.deleted_count} old backups`,
      deleted_count: result.deleted_count,
    });
  } catch (error) {
    logger.error("Cleanup error:", error);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
