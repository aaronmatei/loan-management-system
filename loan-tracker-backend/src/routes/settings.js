import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);
router.use(authorize("admin"));

// Get company settings
router.get("/company", async (req, res) => {
  try {
    // company_settings is a per-tenant singleton.
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }

    const result = await query(
      "SELECT * FROM company_settings WHERE tenant_id = $1",
      [tid],
    );

    if (result.rows.length === 0) {
      await query(
        `INSERT INTO company_settings (tenant_id, company_name, company_address, company_phone)
         VALUES ($1, 'Your Company', 'Address', '+254700000000')`,
        [tid],
      );
      const newResult = await query(
        "SELECT * FROM company_settings WHERE tenant_id = $1",
        [tid],
      );
      return res.json({ success: true, data: newResult.rows[0] });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error("Get settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// Update company settings
router.put("/company", async (req, res) => {
  try {
    const {
      company_name,
      company_address,
      company_phone,
      company_email,
      company_website,
      business_registration_number,
      tax_pin,
      agreement_terms,
      bank_name,
      bank_account_number,
      bank_branch,
      mpesa_paybill,
      mpesa_till_number,
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }

    const existing = await query(
      "SELECT id FROM company_settings WHERE tenant_id = $1",
      [tid],
    );

    if (existing.rows.length === 0) {
      await query(
        `
        INSERT INTO company_settings (
          tenant_id, company_name, company_address, company_phone, company_email,
          company_website, business_registration_number, tax_pin,
          agreement_terms, bank_name, bank_account_number, bank_branch,
          mpesa_paybill, mpesa_till_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
        [
          tid,
          company_name,
          company_address,
          company_phone,
          company_email,
          company_website,
          business_registration_number,
          tax_pin,
          agreement_terms,
          bank_name,
          bank_account_number,
          bank_branch,
          mpesa_paybill,
          mpesa_till_number,
        ],
      );
    } else {
      await query(
        `
        UPDATE company_settings SET
          company_name = $1, company_address = $2, company_phone = $3,
          company_email = $4, company_website = $5, business_registration_number = $6,
          tax_pin = $7, agreement_terms = $8, bank_name = $9,
          bank_account_number = $10, bank_branch = $11,
          mpesa_paybill = $12, mpesa_till_number = $13,
          updated_at = NOW()
        WHERE id = $14 AND tenant_id = $15
      `,
        [
          company_name,
          company_address,
          company_phone,
          company_email,
          company_website,
          business_registration_number,
          tax_pin,
          agreement_terms,
          bank_name,
          bank_account_number,
          bank_branch,
          mpesa_paybill,
          mpesa_till_number,
          existing.rows[0].id,
          tid,
        ],
      );
    }

    logger.info("✓ Company settings updated");
    res.json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    logger.error("Update settings error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ============================================================
// LOAN POLICY (per-tenant lending defaults on the tenants row)
//   Annual interest rate, processing fee rate, and the amount/
//   duration bounds. Drives the staff loan form and the customer
//   portal calculator/application.
// ============================================================
router.get("/loan-policy", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    const result = await query(
      `SELECT
         COALESCE(default_interest_rate, 50.00) AS default_interest_rate,
         COALESCE(processing_fee_rate,   0)     AS processing_fee_rate,
         COALESCE(default_loan_duration, 6)     AS default_loan_duration,
         COALESCE(min_loan_amount,       1000)  AS min_loan_amount,
         COALESCE(max_loan_amount,    1000000)  AS max_loan_amount,
         COALESCE(late_payment_fee,      500)   AS late_payment_fee
       FROM tenants WHERE id = $1`,
      [tid],
    );
    res.json({ success: true, data: result.rows[0] || {} });
  } catch (error) {
    logger.error("Get loan policy error:", error);
    res.status(500).json({ error: "Failed to fetch loan policy" });
  }
});

router.put("/loan-policy", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }

    const {
      default_interest_rate,
      processing_fee_rate,
      default_loan_duration,
      min_loan_amount,
      max_loan_amount,
      late_payment_fee,
    } = req.body || {};

    // Percentages must be sane (0–100). Other fields just non-negative.
    const pct = (v) => v === undefined || v === null || v === "" ? null : Number(v);
    const ir = pct(default_interest_rate);
    const pf = pct(processing_fee_rate);
    if (ir !== null && (Number.isNaN(ir) || ir < 0 || ir > 1000)) {
      return res.status(400).json({ error: "Interest rate must be 0–1000%" });
    }
    if (pf !== null && (Number.isNaN(pf) || pf < 0 || pf > 100)) {
      return res
        .status(400)
        .json({ error: "Processing fee rate must be 0–100%" });
    }

    await query(
      `UPDATE tenants SET
         default_interest_rate = COALESCE($1, default_interest_rate),
         processing_fee_rate   = COALESCE($2, processing_fee_rate),
         default_loan_duration = COALESCE($3, default_loan_duration),
         min_loan_amount       = COALESCE($4, min_loan_amount),
         max_loan_amount       = COALESCE($5, max_loan_amount),
         late_payment_fee      = COALESCE($6, late_payment_fee),
         updated_at = NOW()
       WHERE id = $7`,
      [
        ir,
        pf,
        default_loan_duration ?? null,
        min_loan_amount ?? null,
        max_loan_amount ?? null,
        late_payment_fee ?? null,
        tid,
      ],
    );

    logger.info("✓ Loan policy updated");
    res.json({ success: true, message: "Loan policy updated successfully" });
  } catch (error) {
    logger.error("Update loan policy error:", error);
    res.status(500).json({ error: "Failed to update loan policy" });
  }
});

export default router;
