// Expo push notifications to the LenderFest mobile app. Tokens are stored per
// device in customer_push_tokens (migration 118), keyed by platform_customer_id.
//
// This never throws to its callers — like notificationDispatcher.notify(), a
// push failure must not break the request that triggered it.
import { Expo } from "expo-server-sdk";
import { query } from "../config/database.js";
import logger from "../config/logger.js";

// A single client. EXPO_ACCESS_TOKEN is optional (enhanced-security accounts);
// the public Expo push API works without it.
const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {},
);

/**
 * Send a push to every device registered to a platform customer.
 * @param {number} platformCustomerId
 * @param {{title:string, body:string, data?:object}} payload
 */
export async function sendPushToCustomer(platformCustomerId, { title, body, data = {} }) {
  if (!platformCustomerId) return { skipped: "no-customer" };
  try {
    const rows = (
      await query(
        `SELECT token FROM customer_push_tokens WHERE platform_customer_id = $1`,
        [platformCustomerId],
      )
    ).rows;
    const tokens = rows.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
    if (tokens.length === 0) return { skipped: "no-tokens" };

    const messages = tokens.map((to) => ({ to, sound: "default", title, body, data }));

    // Send in chunks; keep tokens aligned with their tickets so we can prune
    // any that Expo reports as no longer registered.
    for (const chunk of expo.chunkPushNotifications(messages)) {
      let tickets = [];
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        logger.error("pushService send error:", err);
        continue;
      }
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i];
        if (t.status === "error" && t.details?.error === "DeviceNotRegistered") {
          await query(`DELETE FROM customer_push_tokens WHERE token = $1`, [chunk[i].to]).catch(
            () => {},
          );
        }
      }
    }
    return { sent: tokens.length };
  } catch (err) {
    logger.error("sendPushToCustomer error:", err);
    return { error: err.message };
  }
}

/**
 * Resolve a client (at a tenant) to its platform customer and push to them.
 * Used by the loan-lifecycle dispatcher, whose context is client-scoped.
 */
export async function sendPushForClient(tenantId, clientId, payload) {
  if (!clientId || !tenantId) return { skipped: "no-client" };
  try {
    const r = await query(
      `SELECT platform_customer_id FROM customer_tenant_links
        WHERE client_id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1`,
      [clientId, tenantId],
    );
    const pcid = r.rows[0]?.platform_customer_id;
    if (!pcid) return { skipped: "no-link" };
    return sendPushToCustomer(pcid, payload);
  } catch (err) {
    logger.error("sendPushForClient error:", err);
    return { error: err.message };
  }
}

export default { sendPushToCustomer, sendPushForClient };
