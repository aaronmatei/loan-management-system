// Vehicle security for logbook loans. Dual-mounted on /api/loans so the paths
// read /api/loans/:loanId/vehicle-security.
//
// A logbook loan is an ordinary installment loan (created/approved/disbursed
// through the standard /api/loans flow, loan_type='logbook' inherited from its
// package). This module just records the pledged vehicle and the lien on its
// logbook, and lets staff release the lien (loan paid off → logbook handed back)
// or mark the vehicle repossessed (default).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { buildVehicleSecurityPdf, NotFoundError } from "../utils/pdfDocuments.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// The loan must exist, be in scope, and be a logbook loan.
async function loadLogbookLoan(req, loanId) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(
    `SELECT * FROM loans WHERE id = $1 AND loan_type = 'logbook'${tc.clause}`,
    [loanId, ...tc.params],
  );
  return r.rows[0] || null;
}

async function loadVehicle(loanId) {
  const r = await query(
    `SELECT * FROM loan_vehicle_security WHERE loan_id = $1`,
    [loanId],
  );
  return r.rows[0] || null;
}

// GET /api/loans/:loanId/vehicle-security
router.get("/:loanId/vehicle-security", async (req, res) => {
  try {
    const loan = await loadLogbookLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Logbook loan not found" });
    const vehicle = await loadVehicle(loan.id);
    res.json({ success: true, data: { loan, vehicle } });
  } catch (e) {
    logger.error("vehicle-security get error:", e);
    res.status(500).json({ error: "Failed to load vehicle security" });
  }
});

// POST /api/loans/:loanId/vehicle-security — create or update (one per loan).
router.post(
  "/:loanId/vehicle-security",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const loan = await loadLogbookLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Logbook loan not found" });

      const {
        make,
        model,
        year,
        registration_number,
        logbook_number,
        chassis_number,
        engine_number,
        color,
        valuation,
        logbook_held,
        storage_location,
        notes,
      } = req.body || {};

      if (!registration_number || !String(registration_number).trim()) {
        return res.status(400).json({ error: "Registration number is required" });
      }
      const value = parseFloat(valuation);
      if (!(value > 0)) {
        return res.status(400).json({ error: "Vehicle valuation must be positive" });
      }
      const yr = year ? parseInt(year, 10) : null;

      const row = await query(
        `INSERT INTO loan_vehicle_security
           (tenant_id, loan_id, make, model, year, registration_number,
            logbook_number, chassis_number, engine_number, color, valuation,
            logbook_held, storage_location, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (loan_id) DO UPDATE SET
            make = EXCLUDED.make, model = EXCLUDED.model, year = EXCLUDED.year,
            registration_number = EXCLUDED.registration_number,
            logbook_number = EXCLUDED.logbook_number,
            chassis_number = EXCLUDED.chassis_number,
            engine_number = EXCLUDED.engine_number,
            color = EXCLUDED.color, valuation = EXCLUDED.valuation,
            logbook_held = EXCLUDED.logbook_held,
            storage_location = EXCLUDED.storage_location,
            notes = EXCLUDED.notes, updated_at = NOW()
         RETURNING *`,
        [
          loan.tenant_id,
          loan.id,
          make || null,
          model || null,
          yr,
          String(registration_number).trim().toUpperCase(),
          logbook_number || null,
          chassis_number || null,
          engine_number || null,
          color || null,
          value,
          logbook_held === undefined ? true : !!logbook_held,
          storage_location || null,
          notes || null,
          req.user.id,
        ],
      );

      await logAudit({
        user: req.user,
        action: "vehicle_security_recorded",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Vehicle security for ${loan.loan_code}: ${[make, model, row.rows[0].registration_number]
          .filter(Boolean)
          .join(" ")} (value KES ${value})`,
        req,
      });

      res.status(201).json({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error("vehicle-security upsert error:", e);
      res.status(500).json({ error: "Failed to save vehicle security" });
    }
  },
);

// POST /api/loans/:loanId/vehicle-security/release — lien cleared, logbook
// returned to the borrower (typically once the loan is paid off).
router.post(
  "/:loanId/vehicle-security/release",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const loan = await loadLogbookLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Logbook loan not found" });
      const vehicle = await loadVehicle(loan.id);
      if (!vehicle) return res.status(404).json({ error: "No vehicle on file" });
      if (vehicle.lien_status === "released") {
        return res.status(400).json({ error: "Lien already released" });
      }
      const row = await query(
        `UPDATE loan_vehicle_security
            SET lien_status='released', logbook_held=false, released_at=NOW(), updated_at=NOW()
          WHERE loan_id=$1 RETURNING *`,
        [loan.id],
      );
      await logAudit({
        user: req.user,
        action: "vehicle_lien_released",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Logbook lien released on ${loan.loan_code} (${vehicle.registration_number})`,
        req,
      });
      res.json({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error("vehicle-security release error:", e);
      res.status(500).json({ error: "Failed to release lien" });
    }
  },
);

// POST /api/loans/:loanId/vehicle-security/repossess — borrower defaulted; the
// lender exercises the lien and repossesses the vehicle.
router.post(
  "/:loanId/vehicle-security/repossess",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const loan = await loadLogbookLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Logbook loan not found" });
      const vehicle = await loadVehicle(loan.id);
      if (!vehicle) return res.status(404).json({ error: "No vehicle on file" });
      if (vehicle.lien_status === "repossessed") {
        return res.status(400).json({ error: "Vehicle already repossessed" });
      }
      const row = await query(
        `UPDATE loan_vehicle_security
            SET lien_status='repossessed', repossessed_at=NOW(), updated_at=NOW(),
                notes = COALESCE($2, notes)
          WHERE loan_id=$1 RETURNING *`,
        [loan.id, req.body?.notes || null],
      );
      await logAudit({
        user: req.user,
        action: "vehicle_repossessed",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Vehicle repossessed on ${loan.loan_code} (${vehicle.registration_number})`,
        req,
      });
      res.json({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error("vehicle-security repossess error:", e);
      res.status(500).json({ error: "Failed to repossess vehicle" });
    }
  },
);

// GET /api/loans/:loanId/vehicle-security/certificate — printable lien
// certificate (PDF).
router.get("/:loanId/vehicle-security/certificate", async (req, res) => {
  try {
    const { buffer, filename } = await buildVehicleSecurityPdf(
      req.params.loanId,
      tenantId(req),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    if (e instanceof NotFoundError) return res.status(404).json({ error: e.message });
    logger.error("vehicle-security certificate error:", e);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

export default router;
