// Operating expenses + per-tenant expense categories.
// CRUD only — no capital-pool integration in this phase. Categories
// are seeded by migration 031 and editable from the Settings page.

import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// ============================================================
// CATEGORIES
// ============================================================

// List all categories for the acting tenant. Includes inactive ones
// so the Settings page can toggle them back on; the create-expense
// modal filters to is_active client-side.
router.get("/categories", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const r = await query(
      `SELECT id, name, icon, is_default, is_active, sort_order
         FROM expense_categories
        WHERE 1=1${t.clause}
        ORDER BY sort_order, name`,
      t.params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List expense categories error:", err);
    res.status(500).json({ error: "Failed to load categories" });
  }
});

// Add a custom category (admin / manager). Defaults are seeded; this
// is for tenants that need their own ("Legal fees", "Insurance", …).
router.post("/categories", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res.status(400).json({ error: "Tenant context required" });
    }
    const { name, icon } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Category name is required" });
    }
    const r = await query(
      `INSERT INTO expense_categories
         (tenant_id, name, icon, is_default, is_active, sort_order)
       VALUES ($1, $2, $3, false, true, 100)
       ON CONFLICT (tenant_id, name) DO UPDATE
         SET is_active = true, updated_at = NOW()
       RETURNING *`,
      [tid, name.trim(), icon || null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Create category error:", err);
    res.status(500).json({ error: "Failed to add category" });
  }
});

// Toggle active or rename (admin / manager).
router.put("/categories/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active } = req.body || {};
    const t = tenantClause(req, 1);
    const r = await query(
      `UPDATE expense_categories
          SET name      = COALESCE($1, name),
              is_active = COALESCE($2, is_active),
              updated_at = NOW()
        WHERE id = $3${t.clause}
        RETURNING *`,
      [name?.trim() || null, is_active, id, ...t.params],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Update category error:", err);
    res.status(500).json({ error: "Failed to update category" });
  }
});

// ============================================================
// EXPENSES
// ============================================================

// List expenses with filters. Joins category for the display name +
// the user who recorded it for the "by" column.
router.get("/", async (req, res) => {
  try {
    const { category_id, date_from, date_to, recurring, q } = req.query;
    const params = [];
    let where = "WHERE 1=1";
    const t = tenantClause(req, params.length, "e.tenant_id");
    where += t.clause;
    params.push(...t.params);

    if (category_id) {
      params.push(parseInt(category_id, 10));
      where += ` AND e.category_id = $${params.length}`;
    }
    if (date_from) {
      params.push(date_from);
      where += ` AND e.expense_date >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      where += ` AND e.expense_date <= $${params.length}`;
    }
    if (recurring === "true") {
      where += ` AND e.is_recurring = true`;
    } else if (recurring === "false") {
      where += ` AND e.is_recurring = false`;
    }
    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      where += ` AND (
        LOWER(COALESCE(e.description, '')) LIKE $${params.length} OR
        LOWER(COALESCE(e.reference, ''))   LIKE $${params.length}
      )`;
    }

    const r = await query(
      `SELECT e.id, e.amount, e.description, e.expense_date,
              e.payment_method, e.reference, e.is_recurring,
              e.recurrence_period, e.created_at, e.updated_at,
              c.id   AS category_id,
              c.name AS category_name,
              c.icon AS category_icon,
              u.first_name || ' ' || u.last_name AS recorded_by_name
         FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id
         LEFT JOIN users u              ON u.id = e.recorded_by
         ${where}
         ORDER BY e.expense_date DESC, e.id DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List expenses error:", err);
    res.status(500).json({ error: "Failed to load expenses" });
  }
});

// Stats — total, this month, last month, by category. One round-trip.
router.get("/stats", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const r = await query(
      `SELECT
         COALESCE(SUM(amount), 0)::float AS total_all,
         COALESCE(SUM(amount) FILTER (
           WHERE date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)
         ), 0)::float AS total_this_month,
         COALESCE(SUM(amount) FILTER (
           WHERE date_trunc('month', expense_date) =
                 date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
         ), 0)::float AS total_last_month,
         COUNT(*)::int AS count_all,
         COUNT(*) FILTER (
           WHERE date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)
         )::int AS count_this_month
       FROM expenses
       WHERE 1=1${t.clause}`,
      t.params,
    );
    const tc = tenantClause(req, 0, "e.tenant_id");
    const byCat = await query(
      `SELECT c.id, c.name, c.icon,
              COALESCE(SUM(e.amount), 0)::float AS total,
              COUNT(e.id)::int                   AS count
         FROM expense_categories c
         LEFT JOIN expenses e ON e.category_id = c.id${
           tc.clause ? ` AND${tc.clause.slice(4)}` : ""
         }
        WHERE c.tenant_id = $${tc.params.length + 1}
        GROUP BY c.id, c.name, c.icon
        ORDER BY total DESC NULLS LAST, c.sort_order`,
      [...tc.params, req.user?.tenant_id || -1],
    );
    res.json({
      success: true,
      data: { ...r.rows[0], by_category: byCat.rows },
    });
  } catch (err) {
    logger.error("Expense stats error:", err);
    res.status(500).json({ error: "Failed to load expense stats" });
  }
});

// Create (admin / manager).
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res.status(400).json({ error: "Tenant context required" });
    }
    const {
      category_id,
      amount,
      description,
      expense_date,
      payment_method,
      reference,
      is_recurring,
      recurrence_period,
    } = req.body || {};

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }
    if (!category_id) {
      return res.status(400).json({ error: "Category is required" });
    }

    const r = await query(
      `INSERT INTO expenses
         (tenant_id, category_id, amount, description, expense_date,
          payment_method, reference, is_recurring, recurrence_period,
          recorded_by)
       VALUES ($1, $2, $3, $4,
               COALESCE($5::date, CURRENT_DATE),
               $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tid,
        category_id,
        amt,
        description || null,
        expense_date || null,
        payment_method || null,
        reference || null,
        Boolean(is_recurring),
        is_recurring ? recurrence_period || "monthly" : null,
        req.user.id,
      ],
    );
    const expense = r.rows[0];

    await logAudit({
      user: req.user,
      action: "expense_created",
      entityType: "expense",
      entityId: expense.id,
      entityCode: null,
      description: `Recorded expense of KES ${amt.toLocaleString()}`,
      newValues: { amount: amt, category_id, description },
      req,
    });

    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    logger.error("Create expense error:", err);
    res.status(500).json({ error: "Failed to record expense" });
  }
});

// Update (admin / manager).
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const t = tenantClause(req, 1);
    const ex = await query(
      `SELECT * FROM expenses WHERE id = $1${t.clause}`,
      [id, ...t.params],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ error: "Expense not found" });
    }
    const existing = ex.rows[0];

    const {
      category_id,
      amount,
      description,
      expense_date,
      payment_method,
      reference,
      is_recurring,
      recurrence_period,
    } = req.body || {};

    let amt = parseFloat(existing.amount);
    if (amount !== undefined) {
      const parsed = parseFloat(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res
          .status(400)
          .json({ error: "Amount must be a positive number" });
      }
      amt = parsed;
    }

    const r = await query(
      `UPDATE expenses
          SET category_id       = COALESCE($1, category_id),
              amount            = $2,
              description       = COALESCE($3, description),
              expense_date      = COALESCE($4::date, expense_date),
              payment_method    = COALESCE($5, payment_method),
              reference         = COALESCE($6, reference),
              is_recurring      = COALESCE($7, is_recurring),
              recurrence_period = CASE
                WHEN COALESCE($7, is_recurring) = true THEN
                  COALESCE($8, recurrence_period, 'monthly')
                ELSE NULL
              END,
              updated_at = NOW()
        WHERE id = $9 AND tenant_id = $10
        RETURNING *`,
      [
        category_id ?? null,
        amt,
        description ?? null,
        expense_date ?? null,
        payment_method ?? null,
        reference ?? null,
        is_recurring,
        recurrence_period ?? null,
        id,
        existing.tenant_id,
      ],
    );

    await logAudit({
      user: req.user,
      action: "expense_updated",
      entityType: "expense",
      entityId: id,
      entityCode: null,
      description: `Updated expense (now KES ${amt.toLocaleString()})`,
      oldValues: { amount: existing.amount, category_id: existing.category_id },
      newValues: { amount: amt, category_id: r.rows[0].category_id },
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Update expense error:", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// Delete (admin only).
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const t = tenantClause(req, 1);
    const ex = await query(
      `SELECT * FROM expenses WHERE id = $1${t.clause}`,
      [id, ...t.params],
    );
    if (ex.rows.length === 0) {
      return res.status(404).json({ error: "Expense not found" });
    }
    await query(`DELETE FROM expenses WHERE id = $1 AND tenant_id = $2`, [
      id,
      ex.rows[0].tenant_id,
    ]);
    await logAudit({
      user: req.user,
      action: "expense_deleted",
      entityType: "expense",
      entityId: id,
      entityCode: null,
      description: `Deleted expense of KES ${parseFloat(
        ex.rows[0].amount,
      ).toLocaleString()}`,
      oldValues: ex.rows[0],
      req,
    });
    res.json({ success: true, message: "Expense deleted" });
  } catch (err) {
    logger.error("Delete expense error:", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

export default router;
