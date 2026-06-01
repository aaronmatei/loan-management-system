// Branches — per-tenant operational units (e.g. "Westlands", "CBD").
// Every tenant has at least one default branch (auto-seeded by the
// 036 migration); admin can add more from Settings → Branches.
//
// Archived branches stay in the DB (clients reference them via FK)
// but are hidden from create-client dropdowns. Default branch is
// protected: cannot archive, cannot reassign default away from an
// archived branch — a fresh default must be picked first.

import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// =============================================================
// GET /branches — list all branches for the acting tenant
// Includes archived rows so Settings can show & restore them.
// Adds `client_count` for the settings table.
// =============================================================
router.get("/", async (req, res) => {
  try {
    const ts = tenantClause(req, 0, "b.tenant_id");
    const r = await query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM clients c WHERE c.branch_id = b.id) AS client_count
         FROM branches b
        WHERE 1=1${ts.clause}
        ORDER BY b.is_default DESC, b.active DESC, b.name ASC`,
      ts.params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List branches error:", err);
    res.status(500).json({ error: "Failed to fetch branches" });
  }
});

// =============================================================
// POST /branches — create a new branch
// =============================================================
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    const { name, code, location, phone, is_default } = req.body || {};
    const cleanName = (name || "").trim();
    if (!cleanName) {
      return res.status(400).json({ error: "Branch name is required" });
    }

    // Per-tenant name uniqueness against active branches.
    const dup = await query(
      `SELECT id FROM branches
        WHERE tenant_id = $1 AND lower(name) = lower($2) AND active`,
      [tid, cleanName],
    );
    if (dup.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "A branch with this name already exists" });
    }

    // If caller asks to make this the new default, demote any existing
    // default in the same tenant so the unique partial index stays
    // satisfied.
    if (is_default) {
      await query(
        `UPDATE branches SET is_default = FALSE, updated_at = NOW()
          WHERE tenant_id = $1 AND is_default`,
        [tid],
      );
    }

    const r = await query(
      `INSERT INTO branches (tenant_id, name, code, location, phone, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tid,
        cleanName,
        code?.trim() || null,
        location?.trim() || null,
        phone?.trim() || null,
        !!is_default,
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "branch",
      entityId: r.rows[0].id,
      entityCode: r.rows[0].code || cleanName,
      description: `Created branch: ${cleanName}`,
      newValues: r.rows[0],
      req,
    });

    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Create branch error:", err);
    res.status(500).json({ error: "Failed to create branch" });
  }
});

// =============================================================
// PUT /branches/:id — rename / edit / set default / restore
// Soft-archive is a separate DELETE route below.
// =============================================================
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const ts = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM branches WHERE id = $1${ts.clause}`,
      [id, ...ts.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const current = existing.rows[0];
    const tid = current.tenant_id;

    const { name, code, location, phone, is_default, active } = req.body || {};
    const cleanName = name === undefined ? current.name : (name || "").trim();
    if (!cleanName) {
      return res.status(400).json({ error: "Branch name is required" });
    }

    // Name uniqueness within tenant (active rows only, excluding self).
    if (cleanName.toLowerCase() !== current.name.toLowerCase()) {
      const dup = await query(
        `SELECT id FROM branches
          WHERE tenant_id = $1 AND lower(name) = lower($2)
            AND id != $3 AND active`,
        [tid, cleanName, id],
      );
      if (dup.rows.length > 0) {
        return res
          .status(409)
          .json({ error: "A branch with this name already exists" });
      }
    }

    // Restoring an archived branch is fine; archiving via PUT is not
    // — use DELETE which carries the FK guard.
    if (active === false && current.active) {
      return res
        .status(400)
        .json({ error: "Use DELETE to archive a branch" });
    }

    // Demote prior default when promoting this one.
    if (is_default && !current.is_default) {
      await query(
        `UPDATE branches SET is_default = FALSE, updated_at = NOW()
          WHERE tenant_id = $1 AND is_default`,
        [tid],
      );
    }
    // Can't strip default off the only default — there must always
    // be exactly one. Setting is_default=false on the current default
    // is only allowed if the request also promotes a different branch
    // (the demote above handles that path).
    if (is_default === false && current.is_default) {
      return res.status(400).json({
        error: "Promote another branch to default first",
      });
    }

    const r = await query(
      `UPDATE branches SET
         name       = $1,
         code       = $2,
         location   = $3,
         phone      = $4,
         is_default = COALESCE($5, is_default),
         active     = COALESCE($6, active),
         updated_at = NOW()
       WHERE id = $7 AND tenant_id = $8
       RETURNING *`,
      [
        cleanName,
        code === undefined ? current.code : code?.trim() || null,
        location === undefined ? current.location : location?.trim() || null,
        phone === undefined ? current.phone : phone?.trim() || null,
        is_default ?? null,
        active ?? null,
        id,
        tid,
      ],
    );

    await logAudit({
      user: req.user,
      action: "updated",
      entityType: "branch",
      entityId: id,
      entityCode: r.rows[0].code || r.rows[0].name,
      description: `Updated branch: ${r.rows[0].name}`,
      oldValues: current,
      newValues: r.rows[0],
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Update branch error:", err);
    res.status(500).json({ error: "Failed to update branch" });
  }
});

// =============================================================
// DELETE /branches/:id — soft-archive
// Guards: cannot archive the default branch, and any clients still
// pointing at this branch must be reassigned first.
// =============================================================
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const ts = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM branches WHERE id = $1${ts.clause}`,
      [id, ...ts.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const current = existing.rows[0];

    if (current.is_default) {
      return res
        .status(400)
        .json({ error: "Cannot archive the default branch" });
    }

    const clientCount = await query(
      `SELECT COUNT(*) AS n FROM clients WHERE branch_id = $1`,
      [id],
    );
    if (parseInt(clientCount.rows[0].n, 10) > 0) {
      return res.status(400).json({
        error:
          "Reassign clients to another branch before archiving this one",
      });
    }

    const r = await query(
      `UPDATE branches SET active = FALSE, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [id, current.tenant_id],
    );

    await logAudit({
      user: req.user,
      action: "deleted",
      entityType: "branch",
      entityId: id,
      entityCode: current.code || current.name,
      description: `Archived branch: ${current.name}`,
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Archive branch error:", err);
    res.status(500).json({ error: "Failed to archive branch" });
  }
});

export default router;
