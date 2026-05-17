import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// ============================================================
// GET ALL CLIENTS
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = "SELECT * FROM clients WHERE 1=1";
    const params = [];
    let paramCount = 0;

    // Filter by search
    if (search) {
      paramCount++;
      queryText += ` AND (
        first_name ILIKE $${paramCount} 
        OR last_name ILIKE $${paramCount} 
        OR phone_number ILIKE $${paramCount}
        OR email ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    // Filter by status
    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      params.push(status);
    }

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    const countResult = await query("SELECT COUNT(*) FROM clients");
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get clients error:", error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ============================================================
// GET SINGLE CLIENT
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query("SELECT * FROM clients WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Get client error:", error);
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

// ============================================================
// CREATE CLIENT
// ============================================================
router.post("/", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone_number,
      email,
      id_number,
      business_name,
      business_type,
      address,
      city,
      county,
    } = req.body;

    // Validation
    if (!first_name || !last_name || !phone_number) {
      return res.status(400).json({
        error: "First name, last name, and phone number are required",
      });
    }

    // ✅ Check phone number uniqueness
    const phoneCheck = await query(
      "SELECT id FROM clients WHERE phone_number = $1",
      [phone_number],
    );
    if (phoneCheck.rows.length > 0) {
      return res.status(409).json({
        error: "A client with this phone number already exists",
      });
    }

    // ✅ Check email uniqueness (if provided)
    if (email) {
      const emailCheck = await query(
        "SELECT id FROM clients WHERE email = $1",
        [email],
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this email already exists",
        });
      }
    }

    // ✅ Check ID number uniqueness (if provided)
    if (id_number) {
      const idCheck = await query(
        "SELECT id FROM clients WHERE id_number = $1",
        [id_number],
      );
      if (idCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this ID number already exists",
        });
      }
    }

    // Generate client code
    const year = new Date().getFullYear();
    const countResult = await query("SELECT COUNT(*) FROM clients");
    const clientCount = parseInt(countResult.rows[0].count) + 1;
    const clientCode = `CLT-${year}-${String(clientCount).padStart(4, "0")}`;

    // Insert client
    const result = await query(
      `INSERT INTO clients (
        client_code, first_name, last_name, phone_number, email,
        id_number, business_name, business_type, address, city, county, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
      RETURNING *`,
      [
        clientCode,
        first_name,
        last_name,
        phone_number,
        email || null,
        id_number || null,
        business_name || null,
        business_type || null,
        address || null,
        city || null,
        county || null,
      ],
    );

    logger.info(`✓ Client created: ${clientCode} - ${first_name} ${last_name}`);

    res.status(201).json({
      success: true,
      message: "Client created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Create client error:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// ============================================================
// UPDATE CLIENT
// ============================================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      phone_number,
      email,
      id_number,
      business_name,
      business_type,
      address,
      city,
      county,
      status,
    } = req.body;

    // Check if client exists
    const existing = await query("SELECT id FROM clients WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const result = await query(
      `UPDATE clients SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        phone_number = COALESCE($3, phone_number),
        email = COALESCE($4, email),
        id_number = COALESCE($5, id_number),
        business_name = COALESCE($6, business_name),
        business_type = COALESCE($7, business_type),
        address = COALESCE($8, address),
        city = COALESCE($9, city),
        county = COALESCE($10, county),
        status = COALESCE($11, status),
        updated_at = NOW()
      WHERE id = $12
      RETURNING *`,
      [
        first_name,
        last_name,
        phone_number,
        email,
        id_number,
        business_name,
        business_type,
        address,
        city,
        county,
        status,
        id,
      ],
    );

    logger.info(`✓ Client updated: ID ${id}`);

    res.json({
      success: true,
      message: "Client updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update client error:", error);
    res.status(500).json({ error: "Failed to update client" });
  }
});

// ============================================================
// DELETE CLIENT (Soft delete - mark as inactive)
// ============================================================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE clients SET status = 'inactive', updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    logger.info(`✓ Client deactivated: ID ${id}`);

    res.json({
      success: true,
      message: "Client deactivated successfully",
    });
  } catch (error) {
    logger.error("Delete client error:", error);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

export default router;
