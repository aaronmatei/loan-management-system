// Books of Accounts (lender). Mounted at /api/books. Presents the lender's
// statutory books derived from existing ledgers — see services/lenderBooksService.
import express from "express";
import { verifyToken, authorize } from "../middleware/auth.js";
import { computeLenderBooks } from "../services/lenderBooksService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// GET /books — the full set (capital, income statement, balance sheet, trial
// balance, loan portfolio/PAR) for the caller's tenant.
router.get("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context — re-login required" });
    const books = await computeLenderBooks(tid);
    if (!books) return res.status(404).json({ error: "Capital pool not initialized" });
    res.json({ success: true, data: books });
  } catch (e) {
    logger.error("lender books error:", e);
    res.status(500).json({ error: "Failed to build books of accounts" });
  }
});

export default router;
