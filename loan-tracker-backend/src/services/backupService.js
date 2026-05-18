import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { query } from "../config/database.js";
import logger from "../config/logger.js";

const execFileAsync = promisify(execFile);

const BACKUP_DIR = path.resolve(
  process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),
);
const DB_NAME = process.env.DB_NAME || "loan_tracker";
const DB_USER = process.env.DB_USER || "aron";
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = String(process.env.DB_PORT || "5432");

// pg client env: pass the password via PGPASSWORD in the child env,
// NEVER interpolated into a shell string (no shell is spawned at all —
// execFile takes an argv array, so filenames/values can't inject).
const pgEnv = () => ({
  ...process.env,
  PGPASSWORD: process.env.DB_PASSWORD || "",
});

const EXEC_OPTS = {
  env: pgEnv(),
  maxBuffer: 64 * 1024 * 1024,
  timeout: 10 * 60 * 1000, // 10 min
};

export const ensureBackupDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    logger.info(`Created backup directory: ${BACKUP_DIR}`);
  }
};

// loan_tracker_manual_2026-05-19_14-30-05.sql
const generateFilename = (type = "manual") => {
  const [date, rest] = new Date().toISOString().split("T");
  const time = rest.split(".")[0].replace(/:/g, "-");
  return `${DB_NAME}_${type}_${date}_${time}.sql`;
};

// Defense in depth: a path handed to restore/delete must live inside
// BACKUP_DIR (the route also sanitises upload names).
const assertInsideBackupDir = (p) => {
  const resolved = path.resolve(p);
  if (resolved !== BACKUP_DIR && !resolved.startsWith(BACKUP_DIR + path.sep)) {
    throw new Error("Refusing to operate on a path outside BACKUP_DIR");
  }
  return resolved;
};

/**
 * Create a database backup with pg_dump. `--clean --if-exists` makes
 * the dump self-cleaning so it can be restored over a populated DB.
 */
export const createBackup = async (options = {}) => {
  ensureBackupDir();
  const { type = "manual", userId = null } = options;

  const filename = generateFilename(type);
  const filePath = path.join(BACKUP_DIR, filename);

  const rec = await query(
    `INSERT INTO backups (filename, file_path, backup_type, status, created_by)
     VALUES ($1, $2, $3, 'in_progress', $4) RETURNING id`,
    [filename, filePath, type, userId],
  );
  const backupId = rec.rows[0].id;

  try {
    logger.info(`📦 Starting backup: ${filename}`);

    await execFileAsync(
      "pg_dump",
      [
        "-h", DB_HOST,
        "-p", DB_PORT,
        "-U", DB_USER,
        "-d", DB_NAME,
        "-f", filePath,
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
      ],
      EXEC_OPTS,
    );

    const fileSize = fs.statSync(filePath).size;
    await query(
      `UPDATE backups SET status = 'success', file_size = $1 WHERE id = $2`,
      [fileSize, backupId],
    );

    logger.info(
      `✓ Backup completed: ${filename} (${(fileSize / 1048576).toFixed(2)} MB)`,
    );
    return {
      success: true,
      id: backupId,
      filename,
      file_path: filePath,
      file_size: fileSize,
      size_mb: (fileSize / 1048576).toFixed(2),
    };
  } catch (error) {
    logger.error("Backup failed:", error);
    // Fix vs. spec: actually mark THIS row failed (spec referenced an
    // undefined options.backupId, so failures stayed 'in_progress').
    await query(
      `UPDATE backups SET status = 'failed', error_message = $1 WHERE id = $2`,
      [error.message, backupId],
    ).catch(() => {});
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // no partial file
    return { success: false, error: error.message };
  }
};

/**
 * Restore from a backup file. Runs inside ONE transaction with
 * ON_ERROR_STOP=1: if the dump is bad/incompatible the whole thing
 * rolls back and the live DB is left untouched (vs. the spec, which
 * applied uncleaned SQL and could half-corrupt the database).
 */
export const restoreBackup = async (filePath, userId) => {
  try {
    const safePath = assertInsideBackupDir(filePath);
    if (!fs.existsSync(safePath)) {
      return { success: false, error: "Backup file not found" };
    }

    logger.warn(`⚠️  Starting RESTORE from: ${path.basename(safePath)}`);

    const safetyBackup = await createBackup({ type: "pre_restore", userId });
    if (safetyBackup.success) {
      logger.info(`✓ Safety backup created: ${safetyBackup.filename}`);
    } else {
      logger.warn("Safety backup failed; continuing with restore.");
    }

    await execFileAsync(
      "psql",
      [
        "-h", DB_HOST,
        "-p", DB_PORT,
        "-U", DB_USER,
        "-d", DB_NAME,
        "-v", "ON_ERROR_STOP=1",
        "--single-transaction",
        "-f", safePath,
      ],
      EXEC_OPTS,
    );

    logger.info(`✓ Database restored from: ${path.basename(safePath)}`);
    return {
      success: true,
      message: "Database restored successfully",
      safety_backup: safetyBackup.success ? safetyBackup.filename : null,
    };
  } catch (error) {
    // --single-transaction means a failure here left the DB unchanged.
    logger.error("Restore failed (DB rolled back, unchanged):", error);
    return { success: false, error: error.message };
  }
};

export const cleanupOldBackups = async (retentionDays = 30) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const old = await query(
      `SELECT id, filename, file_path FROM backups
       WHERE created_at < $1 AND backup_type IN ('scheduled', 'manual')`,
      [cutoff],
    );

    let deletedCount = 0;
    for (const b of old.rows) {
      try {
        const resolved = path.resolve(b.file_path);
        if (
          (resolved === BACKUP_DIR ||
            resolved.startsWith(BACKUP_DIR + path.sep)) &&
          fs.existsSync(resolved)
        ) {
          fs.unlinkSync(resolved);
        }
        await query("DELETE FROM backups WHERE id = $1", [b.id]);
        deletedCount++;
      } catch (err) {
        logger.error(`Failed to delete backup ${b.filename}:`, err);
      }
    }

    if (deletedCount > 0) {
      logger.info(`🗑️  Cleaned up ${deletedCount} old backups`);
    }
    return { success: true, deleted_count: deletedCount };
  } catch (error) {
    logger.error("Cleanup failed:", error);
    return { success: false, error: error.message };
  }
};

export const getBackupStats = async () => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) AS total_backups,
        COUNT(CASE WHEN backup_type = 'manual' THEN 1 END) AS manual_count,
        COUNT(CASE WHEN backup_type = 'scheduled' THEN 1 END) AS scheduled_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS successful,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
        COALESCE(SUM(file_size), 0) AS total_size,
        MAX(created_at) AS last_backup
      FROM backups
    `);
    return stats.rows[0];
  } catch (error) {
    logger.error("Failed to get backup stats:", error);
    return null;
  }
};

export const BACKUP_DIR_RESOLVED = BACKUP_DIR;

export default {
  createBackup,
  restoreBackup,
  cleanupOldBackups,
  getBackupStats,
  ensureBackupDir,
};
