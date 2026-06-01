// Loan packages — per-tenant pre-configured loan products (e.g.
// "Quick Cash 30", "Boda Boda 12mo"). A package locks the financial
// mechanics (interest rate, processing fee, interest method) and
// range-validates amount + duration when staff or a customer applies
// for a loan referencing it.
//
// Archived packages stay in the DB so loans.package_id can still
// resolve in reports — they're just hidden from create-loan
// dropdowns.

import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

const METHODS = ["flat", "reducing"];

// Shared payload validation — used by POST + PUT. Returns null when
// the input is valid; otherwise a string suitable for a 400 body.
function validatePayload(body, { partial = false } = {}) {
  const {
    name,
    annual_interest_rate,
    processing_fee_rate,
    interest_method,
    min_amount,
    max_amount,
    min_duration_months,
    max_duration_months,
  } = body || {};

  if (!partial || name !== undefined) {
    if (!name || !String(name).trim()) return "Package name is required";
  }
  if (!partial || annual_interest_rate !== undefined) {
    const r = parseFloat(annual_interest_rate);
    if (!Number.isFinite(r) || r < 0) {
      return "Annual interest rate must be a non-negative number";
    }
  }
  if (processing_fee_rate !== undefined && processing_fee_rate !== null) {
    const f = parseFloat(processing_fee_rate);
    if (!Number.isFinite(f) || f < 0 || f > 100) {
      return "Processing fee rate must be between 0 and 100";
    }
  }
  if (interest_method !== undefined && interest_method !== null) {
    if (!METHODS.includes(String(interest_method).toLowerCase())) {
      return `Interest method must be one of: ${METHODS.join(", ")}`;
    }
  }
  if (!partial || min_amount !== undefined || max_amount !== undefined) {
    const mn = parseFloat(min_amount);
    const mx = parseFloat(max_amount);
    if (!Number.isFinite(mn) || mn <= 0) return "min_amount must be > 0";
    if (!Number.isFinite(mx) || mx < mn) {
      return "max_amount must be ≥ min_amount";
    }
  }
  if (
    !partial ||
    min_duration_months !== undefined ||
    max_duration_months !== undefined
  ) {
    const mn = parseInt(min_duration_months, 10);
    const mx = parseInt(max_duration_months, 10);
    if (!Number.isInteger(mn) || mn <= 0) {
      return "min_duration_months must be a positive integer";
    }
    if (!Number.isInteger(mx) || mx < mn) {
      return "max_duration_months must be ≥ min_duration_months";
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// GET /packages — list (includes archived rows for the Settings view).
//                 Adds loan_count so admins see usage at a glance.
// ─────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const ts = tenantClause(req, 0, "p.tenant_id");
    const r = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM loans l WHERE l.package_id = p.id)
                AS loan_count
         FROM loan_packages p
        WHERE 1=1${ts.clause}
        ORDER BY p.active DESC, p.name ASC`,
      ts.params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List packages error:", err);
    res.status(500).json({ error: "Failed to fetch packages" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /packages — create
// ─────────────────────────────────────────────────────────────
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    const err = validatePayload(req.body);
    if (err) return res.status(400).json({ error: err });

    const {
      name,
      description,
      annual_interest_rate,
      processing_fee_rate,
      interest_method,
      min_amount,
      max_amount,
      min_duration_months,
      max_duration_months,
    } = req.body;

    const cleanName = name.trim();
    const dup = await query(
      `SELECT id FROM loan_packages
        WHERE tenant_id = $1 AND lower(name) = lower($2) AND active`,
      [tid, cleanName],
    );
    if (dup.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "A package with this name already exists" });
    }

    const r = await query(
      `INSERT INTO loan_packages (
         tenant_id, name, description,
         annual_interest_rate, processing_fee_rate, interest_method,
         min_amount, max_amount, min_duration_months, max_duration_months
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        tid,
        cleanName,
        description?.trim() || null,
        parseFloat(annual_interest_rate),
        processing_fee_rate == null ? 0 : parseFloat(processing_fee_rate),
        (interest_method || "flat").toLowerCase(),
        parseFloat(min_amount),
        parseFloat(max_amount),
        parseInt(min_duration_months, 10),
        parseInt(max_duration_months, 10),
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "loan_package",
      entityId: r.rows[0].id,
      entityCode: cleanName,
      description: `Created loan package: ${cleanName}`,
      newValues: r.rows[0],
      req,
    });

    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Create package error:", err);
    res.status(500).json({ error: "Failed to create package" });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /packages/:id — edit (and restore via active=true)
// ─────────────────────────────────────────────────────────────
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const ts = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM loan_packages WHERE id = $1${ts.clause}`,
      [id, ...ts.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Package not found" });
    }
    const cur = existing.rows[0];

    const err = validatePayload(req.body, { partial: true });
    if (err) return res.status(400).json({ error: err });

    const cleanName =
      req.body.name === undefined ? cur.name : req.body.name.trim();
    if (cleanName.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = await query(
        `SELECT id FROM loan_packages
          WHERE tenant_id = $1 AND lower(name) = lower($2)
            AND id != $3 AND active`,
        [cur.tenant_id, cleanName, id],
      );
      if (dup.rows.length > 0) {
        return res
          .status(409)
          .json({ error: "A package with this name already exists" });
      }
    }

    // Archiving must go through DELETE so the FK-guard runs.
    if (req.body.active === false && cur.active) {
      return res
        .status(400)
        .json({ error: "Use DELETE to archive a package" });
    }

    const r = await query(
      `UPDATE loan_packages SET
         name                  = $1,
         description           = $2,
         annual_interest_rate  = COALESCE($3, annual_interest_rate),
         processing_fee_rate   = COALESCE($4, processing_fee_rate),
         interest_method       = COALESCE($5, interest_method),
         min_amount            = COALESCE($6, min_amount),
         max_amount            = COALESCE($7, max_amount),
         min_duration_months   = COALESCE($8, min_duration_months),
         max_duration_months   = COALESCE($9, max_duration_months),
         active                = COALESCE($10, active),
         updated_at            = NOW()
       WHERE id = $11 AND tenant_id = $12
       RETURNING *`,
      [
        cleanName,
        req.body.description === undefined
          ? cur.description
          : req.body.description?.trim() || null,
        req.body.annual_interest_rate == null
          ? null
          : parseFloat(req.body.annual_interest_rate),
        req.body.processing_fee_rate == null
          ? null
          : parseFloat(req.body.processing_fee_rate),
        req.body.interest_method
          ? String(req.body.interest_method).toLowerCase()
          : null,
        req.body.min_amount == null ? null : parseFloat(req.body.min_amount),
        req.body.max_amount == null ? null : parseFloat(req.body.max_amount),
        req.body.min_duration_months == null
          ? null
          : parseInt(req.body.min_duration_months, 10),
        req.body.max_duration_months == null
          ? null
          : parseInt(req.body.max_duration_months, 10),
        req.body.active ?? null,
        id,
        cur.tenant_id,
      ],
    );

    await logAudit({
      user: req.user,
      action: "updated",
      entityType: "loan_package",
      entityId: id,
      entityCode: r.rows[0].name,
      description: `Updated loan package: ${r.rows[0].name}`,
      oldValues: cur,
      newValues: r.rows[0],
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Update package error:", err);
    res.status(500).json({ error: "Failed to update package" });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /packages/:id — soft-archive. Loans still resolve via FK.
// ─────────────────────────────────────────────────────────────
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const ts = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM loan_packages WHERE id = $1${ts.clause}`,
      [id, ...ts.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Package not found" });
    }
    const cur = existing.rows[0];

    const r = await query(
      `UPDATE loan_packages SET active = FALSE, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [id, cur.tenant_id],
    );

    await logAudit({
      user: req.user,
      action: "deleted",
      entityType: "loan_package",
      entityId: id,
      entityCode: cur.name,
      description: `Archived loan package: ${cur.name}`,
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Archive package error:", err);
    res.status(500).json({ error: "Failed to archive package" });
  }
});

export default router;
