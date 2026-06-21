// Welfare documents — staff/admin side. Mounted at
// /api/welfares/:welfareId/documents. Admin/manager/loan_officer upload and
// view; admin/manager delete. The member-facing side (upload by any member,
// visibility filtering) lives in routes/portal/member.js. See migration 097.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { CATEGORIES, VISIBILITIES, runDocUpload, storeDocFile, isCloudinaryConfigured, cleanCategory } from "../services/welfareDocumentService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Resolve + tenant-check the welfare for every request.
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (documents) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /documents — every document for this welfare (staff see all visibilities).
router.get("/", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, title, category, visibility, file_url, file_name, mime, size_bytes,
              meeting_id, uploaded_by_member, uploaded_by_user, uploaded_by_name, created_at
         FROM welfare_documents WHERE welfare_id = $1 ORDER BY created_at DESC`,
      [req.welfare.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("welfare documents list error:", e);
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// POST /documents — upload (multipart: file + title/category/visibility).
router.post("/", authorize("admin", "manager", "loan_officer"), runDocUpload, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(503).json({ error: "File storage is not configured yet." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required" });
    const visibility = VISIBILITIES.includes(req.body?.visibility) ? req.body.visibility : "members";
    const url = await storeDocFile(req.file, req.welfare.id);
    const r = await query(
      `INSERT INTO welfare_documents
         (tenant_id, welfare_id, title, category, visibility, file_url, file_name, mime, size_bytes, meeting_id, uploaded_by_user, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.welfare.tenant_id, req.welfare.id, title, cleanCategory(req.body?.category), visibility,
        url, req.file.originalname?.slice(0, 200) || null, req.file.mimetype, req.file.size,
        req.body?.meeting_id ? parseInt(req.body.meeting_id, 10) : null,
        req.user.id, `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email || "Staff",
      ],
    );
    await logAudit({ user: req.user, action: "created", entityType: "welfare_document", entityId: r.rows[0].id, entityCode: title, description: `Uploaded document: ${title}`, req });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare document upload error:", e);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// DELETE /documents/:id — admin/manager remove any document.
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await query(`DELETE FROM welfare_documents WHERE id = $1 AND welfare_id = $2 RETURNING title`, [req.params.id, req.welfare.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Document not found" });
    await logAudit({ user: req.user, action: "deleted", entityType: "welfare_document", entityId: Number(req.params.id), entityCode: r.rows[0].title, description: `Deleted document: ${r.rows[0].title}`, req });
    res.json({ success: true });
  } catch (e) {
    logger.error("welfare document delete error:", e);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

export { CATEGORIES };
export default router;
