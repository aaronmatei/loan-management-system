// Invite a welfare member to the self-service portal. A member becomes a
// platform_customers login (the same identity borrowers use) linked to the
// welfare tenant via customer_tenant_links.member_id. The member then logs in
// at /portal, selects the welfare, and sees their savings/contributions/loans
// — and can also borrow from lenders with the same account.
import bcryptjs from "bcryptjs";
import { query } from "../config/database.js";
import { sendWelfareSms } from "./welfareSmsService.js";
import { sendEmail } from "./emailService.js";
import logger from "../config/logger.js";

// A readable temporary password (no ambiguous chars) the member is forced to
// change on first login. Has an uppercase letter, a digit, and a separator, so
// it's typeable from an SMS/email. Not run through validatePassword — only the
// member's chosen new password is.
function genTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `Lf-${s}`;
}

const APP = () => process.env.APP_URL || "https://app.lenderfest.loans";

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

// Provision + link + notify, in one call. `welfare` is the groups row (has
// tenant_id + name); `member` is the members row.
//
// The member gets a self-service login at the welfare-MEMBER door
// (/welfare/member/login), NOT the borrower portal. If they haven't set their
// own password yet, the admin invite hands them a temporary one + sets
// must_change_password, and they're sent to /welfare/member/register to choose
// their own. Notifications go by BOTH email and SMS where each is on file.
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

  // Only hand out a temp password if the member hasn't set their own yet — a
  // re-invite must never clobber a real password. must_change_password=true
  // means they're still on a default, so re-issue a fresh one.
  const cur = await query(
    "SELECT password_hash, must_change_password FROM platform_customers WHERE id = $1",
    [customerId],
  );
  const c = cur.rows[0] || {};
  const needsTempPassword = !c.password_hash || c.must_change_password;

  let tempPassword = null;
  if (needsTempPassword) {
    tempPassword = genTempPassword();
    const hash = await bcryptjs.hash(tempPassword, 10);
    // phone_verified=true so the admin-vouched member can log in immediately;
    // must_change_password forces them to set their own at first login.
    await query(
      `UPDATE platform_customers
          SET password_hash = $1, must_change_password = true,
              phone_verified = true, is_active = true, updated_at = NOW()
        WHERE id = $2`,
      [hash, customerId],
    );
  }

  const name = member.first_name || "there";
  const registerUrl = `${APP()}/welfare/member/register`;
  const loginUrl = `${APP()}/welfare/member/login`;

  const smsMessage = tempPassword
    ? `Hi ${name}, you've been added to ${welfare.name} on LenderFest. Set your password at ${registerUrl} using phone ${member.phone_number} and temporary password ${tempPassword}.`
    : `Hi ${name}, you've been added to ${welfare.name} on LenderFest. Log in at ${loginUrl} to view your savings, contributions and loans.`;

  // Both channels are best-effort — a failed notification must never undo the
  // link or the password setup.
  let smsSent = false;
  let emailSent = false;
  if (member.phone_number) {
    try {
      await sendWelfareSms({
        tenantId: welfare.tenant_id,
        phone: member.phone_number,
        message: smsMessage,
        type: "member_invite",
        sentBy,
      });
      smsSent = true;
    } catch (e) {
      logger.error("member invite SMS error:", e.message);
    }
  }
  if (member.email) {
    try {
      const r = await sendEmail({
        to: member.email,
        subject: `You've been added to ${welfare.name} on LenderFest`,
        fromName: welfare.name,
        html: memberInviteEmail({ name, welfareName: welfare.name, phone: member.phone_number, tempPassword, registerUrl, loginUrl }),
      });
      emailSent = r?.success !== false;
    } catch (e) {
      logger.error("member invite email error:", e.message);
    }
  }

  return { customerId, isNew, alreadyLinked, link, tempPassword: !!tempPassword, smsSent, emailSent };
}

function memberInviteEmail({ name, welfareName, phone, tempPassword, registerUrl, loginUrl }) {
  const creds = tempPassword
    ? `<p>Get started by setting your password:</p>
       <p style="margin:16px 0">
         <a href="${registerUrl}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set your password</a>
       </p>
       <table style="border-collapse:collapse;margin:8px 0">
         <tr><td style="padding:4px 12px 4px 0;color:#555">Phone</td><td style="font-weight:600">${phone || ""}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#555">Temporary password</td><td style="font-weight:600">${tempPassword}</td></tr>
       </table>
       <p style="color:#777;font-size:13px">You'll be asked to choose your own password.</p>`
    : `<p style="margin:16px 0">
         <a href="${loginUrl}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Log in</a>
       </p>`;
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
    <h2 style="margin:0 0 8px">Welcome to ${welfareName}</h2>
    <p>Hi ${name}, you've been added as a member of <strong>${welfareName}</strong> on LenderFest. You can now view your savings, contributions, loans and meetings from your member portal.</p>
    ${creds}
    <p style="color:#999;font-size:12px;margin-top:24px">If you didn't expect this, you can ignore this email.</p>
  </div>`;
}
