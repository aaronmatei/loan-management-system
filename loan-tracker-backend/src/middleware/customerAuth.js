import jwt from "jsonwebtoken";
import { query } from "../config/database.js";

export const verifyCustomer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token" });
    }
    const decoded = jwt.verify(
      authHeader.split(" ")[1],
      process.env.JWT_SECRET,
    );

    if (decoded.user_type !== "customer") {
      return res.status(403).json({ error: "Customer access only" });
    }
    if (decoded.needs_tenant_selection) {
      return res.status(403).json({
        error: "Please select a tenant first",
        action: "select_tenant",
      });
    }

    const cr = await query(
      "SELECT * FROM platform_customers WHERE id = $1 AND is_active = true",
      [decoded.platform_customer_id],
    );
    if (cr.rows.length === 0) {
      return res.status(401).json({ error: "Account not found" });
    }
    if (cr.rows[0].is_blacklisted_platform) {
      return res.status(403).json({ error: "Account suspended" });
    }

    if (decoded.current_tenant_id) {
      const link = await query(
        `SELECT 1 FROM customer_tenant_links
         WHERE platform_customer_id = $1 AND tenant_id = $2 AND status = 'active'`,
        [decoded.platform_customer_id, decoded.current_tenant_id],
      );
      if (link.rows.length === 0) {
        return res.status(403).json({ error: "No access to this tenant" });
      }
    }

    req.customer = cr.rows[0];
    req.platformCustomerId = decoded.platform_customer_id;
    req.currentTenantId = decoded.current_tenant_id;
    req.currentClientId = decoded.current_client_id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

export default { verifyCustomer };
