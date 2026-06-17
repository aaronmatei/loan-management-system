// Invite a welfare member to the self-service portal. A member becomes a
// platform_customers login (the same identity borrowers use) linked to the
// welfare tenant via customer_tenant_links.member_id. The member then logs in
// at /portal, selects the welfare, and sees their savings/contributions/loans
// — and can also borrow from lenders with the same account.
import { query } from "../config/database.js";
import { sendWelfareSms } from "./welfareSmsService.js";
import logger from "../config/logger.js";

// Normalize to the +254XXXXXXXXX shape platform_customers.phone_number uses
// (mirrors formatPhone in routes/portal/auth.js).
function formatPhone(phone) {
  if (!phone) return null;
  let c = String(phone).replace(/[\s\-()]/g, "");
  if (c.startsWith("+")) c = c.slice(1);
  if (c.startsWith("0")) c = "254" + c.slice(1);
  if (!c.startsWith("254")) c = "254" + c;
  return "+" + c;
}

// Find or create the platform_customers row for a member's phone. id_number is
// NOT NULL on platform_customers, so the member must have one. Returns
// { customerId, isNew }.
export async function provisionPlatformCustomerByPhone({
  phone,
  firstName,
  lastName,
  idNumber,
  email,
}) {
  const fp = formatPhone(phone);
  if (!fp) throw Object.assign(new Error("Member has no phone number"), { status: 400 });
  if (!idNumber) throw Object.assign(new Error("Member has no ID number"), { status: 400 });

  const existing = await query(
    "SELECT id, id_number FROM platform_customers WHERE phone_number = $1",
    [fp],
  );
  if (existing.rows.length > 0) {
    const c = existing.rows[0];
    if (c.id_number && String(c.id_number) !== String(idNumber)) {
      throw Object.assign(
        new Error("This phone already has a portal account under a different ID number."),
        { status: 409 },
      );
    }
    if (!c.id_number) {
      await query("UPDATE platform_customers SET id_number = $1, updated_at = NOW() WHERE id = $2", [
        idNumber,
        c.id,
      ]);
    }
    return { customerId: c.id, isNew: false };
  }

  const idClash = await query("SELECT id FROM platform_customers WHERE id_number = $1", [idNumber]);
  if (idClash.rows.length > 0) {
    throw Object.assign(
      new Error("This ID number already has a portal account under a different phone."),
      { status: 409 },
    );
  }
  const nc = await query(
    `INSERT INTO platform_customers (phone_number, id_number, first_name, last_name, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [fp, idNumber, firstName || null, lastName || null, email || null],
  );
  return { customerId: nc.rows[0].id, isNew: true };
}

// Link a member to a portal customer for the welfare tenant. Idempotent — if the
// member is already linked, returns that link. Returns { link, alreadyLinked }.
export async function linkMemberToCustomer({ customerId, tenantId, memberId }) {
  const existing = await query(
    "SELECT * FROM customer_tenant_links WHERE member_id = $1",
    [memberId],
  );
  if (existing.rows.length > 0) {
    return { link: existing.rows[0], alreadyLinked: true };
  }
  const r = await query(
    `INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, member_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING *`,
    [customerId, tenantId, memberId],
  );
  return { link: r.rows[0], alreadyLinked: false };
}

// Provision + link + SMS, in one call. `welfare` is the groups row (has
// tenant_id + name); `member` is the members row.
export async function inviteMemberToPortal({ welfare, member, sentBy = null }) {
  const { customerId, isNew } = await provisionPlatformCustomerByPhone({
    phone: member.phone_number,
    firstName: member.first_name,
    lastName: member.last_name,
    idNumber: member.id_number,
    email: member.email,
  });
  const { link, alreadyLinked } = await linkMemberToCustomer({
    customerId,
    tenantId: welfare.tenant_id,
    memberId: member.id,
  });

  const loginUrl = (process.env.APP_URL || "https://app.lenderfest.loans") + "/portal/login";
  const name = member.first_name || "there";
  const message = `Hi ${name}, you've been added to ${welfare.name} on LenderFest. Log in at ${loginUrl} with your phone number to view your savings, contributions and loans.`;
  // Best-effort — never let SMS failure undo the link.
  try {
    await sendWelfareSms({
      tenantId: welfare.tenant_id,
      phone: member.phone_number,
      message,
      type: "member_invite",
      sentBy,
    });
  } catch (e) {
    logger.error("member invite SMS error:", e.message);
  }

  return { customerId, isNew, alreadyLinked, link };
}
