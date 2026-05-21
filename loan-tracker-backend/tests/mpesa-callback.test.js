// Suite B — M-Pesa STK callback. No outbound Daraja in the callback path
// (we insert pending mpesa_transactions rows directly), so no network
// mocking is needed. The idempotency test is the highest-value one in the
// whole batch: a replayed Safaricom callback must never double-credit.
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import {
  createTenant,
  createClient,
  createLoan,
  loanBalance,
} from "./helpers/factory.js";

async function setup(amountDue = 56000) {
  const tenant = await createTenant();
  const client = await createClient(tenant.id);
  const loan = await createLoan(tenant.id, client.id, {
    total_amount_due: amountDue,
    status: "active",
  });
  return { tenant, client, loan };
}

async function insertPending({ tenant, loan, cid, amount }) {
  await query(
    `INSERT INTO mpesa_transactions
       (tenant_id, purpose, loan_id, phone_number, amount,
        account_reference, transaction_desc, merchant_request_id,
        checkout_request_id, status, created_at)
     VALUES ($1,'loan_repayment',$2,$3,$4,$5,'Loan Repay',$6,$7,'pending',NOW())`,
    [tenant.id, loan.id, "254708374149", amount, loan.loan_code || "LN", `m-${cid}`, cid],
  );
}

const successBody = (cid, { amount = 20000, receipt = "QABC123XYZ" } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: `m-${cid}`,
      CheckoutRequestID: cid,
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: amount },
          { Name: "MpesaReceiptNumber", Value: receipt },
          { Name: "TransactionDate", Value: 20260521120000 },
          { Name: "PhoneNumber", Value: 254708374149 },
        ],
      },
    },
  },
});

const failBody = (cid, code, desc) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: `m-${cid}`,
      CheckoutRequestID: cid,
      ResultCode: code,
      ResultDesc: desc,
    },
  },
});

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

describe("M-Pesa callback", () => {
  it("success callback records the payment and flips the row to success", async () => {
    const { tenant, loan } = await setup();
    const cid = `ws_CO_succ_${Date.now()}`;
    await insertPending({ tenant, loan, cid, amount: 20000 });

    const res = await request(app)
      .post("/api/mpesa/callback")
      .send(successBody(cid, { amount: 20000 }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(ACK);

    const row = (
      await query(
        "SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1",
        [cid],
      )
    ).rows[0];
    expect(row.status).toBe("success");
    expect(row.mpesa_receipt_number).toBe("QABC123XYZ");

    const txns = (
      await query(
        "SELECT * FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'",
        [loan.id],
      )
    ).rows;
    expect(txns.length).toBe(1);
    expect(parseFloat(txns[0].amount_paid)).toBe(20000);
    expect(txns[0].payment_method).toBe("mpesa");
    expect(txns[0].payment_reference).toBe("QABC123XYZ");
    expect(await loanBalance(loan.id)).toBe(36000);
  });

  it("duplicate success callback does NOT double-credit (idempotent)", async () => {
    const { tenant, loan } = await setup();
    const cid = `ws_CO_idem_${Date.now()}`;
    await insertPending({ tenant, loan, cid, amount: 20000 });

    await request(app).post("/api/mpesa/callback").send(successBody(cid)).expect(200);
    await request(app).post("/api/mpesa/callback").send(successBody(cid)).expect(200);

    const txns = (
      await query(
        "SELECT * FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'",
        [loan.id],
      )
    ).rows;
    expect(txns.length).toBe(1); // only ONE payment despite two callbacks
    expect(await loanBalance(loan.id)).toBe(36000); // balance moved once
  });

  it("cancel (ResultCode 1032) → cancelled, no payment", async () => {
    const { tenant, loan } = await setup();
    const cid = `ws_CO_cancel_${Date.now()}`;
    await insertPending({ tenant, loan, cid, amount: 20000 });

    await request(app)
      .post("/api/mpesa/callback")
      .send(failBody(cid, 1032, "Request cancelled by user"))
      .expect(200);

    const row = (
      await query(
        "SELECT status FROM mpesa_transactions WHERE checkout_request_id = $1",
        [cid],
      )
    ).rows[0];
    expect(row.status).toBe("cancelled");
    const c = (
      await query("SELECT COUNT(*) c FROM transactions WHERE loan_id = $1", [loan.id])
    ).rows[0];
    expect(parseInt(c.c, 10)).toBe(0);
    expect(await loanBalance(loan.id)).toBe(56000);
  });

  it("timeout (ResultCode 1037) → timeout, no payment", async () => {
    const { tenant, loan } = await setup();
    const cid = `ws_CO_timeout_${Date.now()}`;
    await insertPending({ tenant, loan, cid, amount: 20000 });

    await request(app)
      .post("/api/mpesa/callback")
      .send(failBody(cid, 1037, "DS timeout. Cannot get response"))
      .expect(200);

    const row = (
      await query(
        "SELECT status FROM mpesa_transactions WHERE checkout_request_id = $1",
        [cid],
      )
    ).rows[0];
    expect(row.status).toBe("timeout");
    const c = (
      await query("SELECT COUNT(*) c FROM transactions WHERE loan_id = $1", [loan.id])
    ).rows[0];
    expect(parseInt(c.c, 10)).toBe(0);
  });

  it("unknown checkout id → still acks, changes nothing", async () => {
    const before = (await query("SELECT COUNT(*) c FROM transactions")).rows[0].c;
    const res = await request(app)
      .post("/api/mpesa/callback")
      .send(successBody(`ws_CO_unknown_${Date.now()}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ACK);
    const after = (await query("SELECT COUNT(*) c FROM transactions")).rows[0].c;
    expect(after).toBe(before);
  });

  it("callback is public; the STK route requires auth", async () => {
    const pub = await request(app)
      .post("/api/mpesa/callback")
      .send(failBody(`ws_CO_pub_${Date.now()}`, 1032, "x"));
    expect(pub.status).toBe(200); // no auth header, still accepted

    const prot = await request(app)
      .post("/api/mpesa/stk/loan-repayment")
      .send({ loan_id: 1, amount: 100, phone: "0708374149" });
    expect(prot.status).toBe(401); // no token → rejected
  });
});
