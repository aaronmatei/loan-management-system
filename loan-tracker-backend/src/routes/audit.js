import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";
import ExcelJS from "exceljs";

const router = express.Router();

router.use(verifyToken);
router.use(authorize("admin", "manager"));

// ============================================================
// GET AUDIT LOGS (with filters)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const {
      user_id,
      action,
      entity_type,
      entity_id,
      date_from,
      date_to,
      search,
      page = 1,
      limit = 10000,
    } = req.query;

    const offset = (page - 1) * limit;
    let queryText = `
      SELECT al.*, u.first_name, u.last_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (user_id) {
      paramCount++;
      queryText += ` AND al.user_id = $${paramCount}`;
      params.push(user_id);
    }

    if (action) {
      paramCount++;
      queryText += ` AND al.action = $${paramCount}`;
      params.push(action);
    }

    if (entity_type) {
      paramCount++;
      queryText += ` AND al.entity_type = $${paramCount}`;
      params.push(entity_type);
    }

    if (entity_id) {
      paramCount++;
      queryText += ` AND al.entity_id = $${paramCount}`;
      params.push(entity_id);
    }

    if (date_from) {
      paramCount++;
      queryText += ` AND al.created_at >= $${paramCount}`;
      params.push(date_from);
    }

    if (date_to) {
      paramCount++;
      queryText += ` AND al.created_at <= $${paramCount}::date + INTERVAL '1 day'`;
      params.push(date_to);
    }

    if (search) {
      paramCount++;
      queryText += ` AND (
        al.description ILIKE $${paramCount}
        OR al.entity_code ILIKE $${paramCount}
        OR al.user_name ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    const at = tenantClause(req, paramCount, "al.tenant_id");
    if (at.clause) {
      paramCount++;
      queryText += at.clause;
      params.push(...at.params);
    }

    queryText += ` ORDER BY al.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const ct = tenantClause(req, 0, "tenant_id");
    const countResult = await query(
      `SELECT COUNT(*) FROM audit_logs WHERE 1=1${ct.clause}`,
      ct.params,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (error) {
    logger.error("Get audit logs error:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// ============================================================
// AUDIT STATISTICS
// ============================================================
router.get("/stats", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const totalsResult = await query(
      `
      SELECT
        COUNT(*) AS total_logs,
        COUNT(DISTINCT user_id) AS unique_users,
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) AS today_count,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) AS week_count,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS month_count
      FROM audit_logs
      WHERE 1=1${t.clause}
    `,
      t.params,
    );

    const actionsResult = await query(
      `
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'${t.clause}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `,
      t.params,
    );

    const ut = tenantClause(req, 0, "u.tenant_id");
    const usersResult = await query(
      `
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        COUNT(al.id) AS activity_count
      FROM users u
      LEFT JOIN audit_logs al
        ON u.id = al.user_id
       AND al.created_at >= CURRENT_DATE - INTERVAL '30 days'
      WHERE 1=1${ut.clause}
      GROUP BY u.id
      ORDER BY activity_count DESC
      LIMIT 10
    `,
      ut.params,
    );

    res.json({
      success: true,
      data: {
        totals: totalsResult.rows[0],
        top_actions: actionsResult.rows,
        most_active_users: usersResult.rows,
      },
    });
  } catch (error) {
    logger.error("Audit stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ============================================================
// AUDIT TRAIL FOR A SPECIFIC ENTITY
// ============================================================
router.get("/entity/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    const et = tenantClause(req, 2, "al.tenant_id");
    const result = await query(
      `SELECT al.*, u.first_name, u.last_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.entity_type = $1 AND al.entity_id = $2${et.clause}
       ORDER BY al.created_at DESC`,
      [entityType, entityId, ...et.params],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get entity audit error:", error);
    res.status(500).json({ error: "Failed to fetch entity audit" });
  }
});

// ============================================================
// EXPORT AUDIT LOGS TO EXCEL
// ============================================================
router.get("/export", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    let queryText = `
      SELECT al.*, u.first_name, u.last_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (date_from) {
      params.push(date_from);
      queryText += ` AND al.created_at >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      queryText += ` AND al.created_at <= $${params.length}::date + INTERVAL '1 day'`;
    }

    const at = tenantClause(req, params.length, "al.tenant_id");
    queryText += at.clause;
    params.push(...at.params);

    queryText += ` ORDER BY al.created_at DESC`;

    const result = await query(queryText, params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Audit Logs");

    sheet.columns = [
      { header: "Date/Time", key: "created_at", width: 20 },
      { header: "User", key: "user_name", width: 25 },
      { header: "Email", key: "user_email", width: 25 },
      { header: "Action", key: "action", width: 18 },
      { header: "Entity Type", key: "entity_type", width: 15 },
      { header: "Entity Code", key: "entity_code", width: 18 },
      { header: "Description", key: "description", width: 50 },
      { header: "IP Address", key: "ip_address", width: 15 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };

    result.rows.forEach((log) => {
      sheet.addRow({
        ...log,
        created_at: new Date(log.created_at).toLocaleString(),
      });
    });

    const filename = `audit_logs_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export audit error:", error);
    res.status(500).json({ error: "Failed to export" });
  }
});

export default router;
