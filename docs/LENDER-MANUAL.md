# LendFest — Lender User Manual

A step-by-step guide for **lenders** (microfinance institutions, SACCOs, chamas,
and individual lenders) using LendFest to run their lending business.

> **What is LendFest?** A cloud loan-management system. You manage clients, loans,
> repayments, capital, staff, and reports from one dashboard — and your borrowers
> get their own self-service portal.

---

## 1. Getting started

### Create your account (free trial)
1. Go to the LendFest home page and click **Start Free Trial**.
2. Fill in:
   - **Business name** (e.g. *Faulu Microfinance*)
   - **Business type** — Microfinance, SACCO, Chama, or Individual Lender
   - **Your subdomain** (e.g. *faulu* → your space at `faulu.lendfest.loans`)
   - **Admin first & last name, email, password**
3. Click **Create account**. Your 14-day free trial starts immediately — no card needed.

**Pricing after the trial:** you pay **5% of the interest you actually earn** each
month. No setup fee, no monthly minimum. Quiet month = no charge.

### Log in
- Staff sign in at **`/login`** with their **email + password**.
- Forgot your password? Use the reset link on the login page.

### Onboarding wizard (first login)
A short setup wizard walks you through:
1. **Business profile** — logo, contact details.
2. **Loan settings** — default interest rate, duration, min/max amounts.
3. **Capital pool** — how much money you have available to lend.
4. **First client** and **first loan** (optional — you can skip and do this later).
5. **Invite your team** (optional).

You can change any of these later in **Settings**.

---

## 2. The Dashboard

Your home screen shows:
- **Capital Pool** — available capital, total disbursed, collected, interest
  earned, and utilization. Admins can **Top up capital** here.
- **KPI cards** — active loans, collections, outstanding, collection rate.
- **Charts** — disbursed vs collected trend, and a portfolio-health donut by loan status.
- **Recent loans & payments**.

---

## 3. Managing clients

### Add a client
**Clients → Add Client**, then enter:
- First & last name, phone number, ID number (required: name + phone)
- Email, **Business name**, **Business type**
- **County**, Town/City, Address
- Date of birth, Gender

Every client you add automatically gets a **borrower portal login** so they can
self-serve. Their default password is:

> **First-initial (capital) + last-initial (lowercase) + ID number + `@<year>`**
> e.g. *John Doe*, ID `12345678` → `Jd12345678@2026`

Share this with the client; they change it on first login.

### Client profile
Click any client to see their **credit score**, all loans, payment history,
**identity documents** (photo + ID front/back they uploaded in the portal), and
options to **Edit**, **Download statement**, **Send SMS**, or **Email statement**.

---

## 4. Loans — the full lifecycle

A loan moves through these stages:

| Status | Meaning |
|---|---|
| **Pending** | Application submitted, not yet reviewed |
| **Under review** | A staff member is reviewing it |
| **Approved** | Approved, **awaiting disbursement** (money not yet paid out) |
| **Counter-offered** | You offered a smaller amount; awaiting the client's response |
| **Rejected** | Declined |
| **Active** | **Disbursed** — money paid out, repayments running |
| **Completed** | Fully repaid |
| **Defaulted** | Overdue / not repaid |

> **Important:** a loan only appears in the borrower's **My Loans** once it is
> **disbursed (Active)**. Before that it stays in their **My Applications**.

### Create a loan for a client
**Loans → New Application**: pick the client, enter principal (within your
min/max), duration, interest rate, and purpose. Add guarantor/collateral if needed.

### Review & decide (Applications)
The **Applications** queue holds everything awaiting a decision — including loans
your borrowers submitted online. For each one you can:
- **Start review** → moves it to *Under review*.
- **Approve** (after review) → *Approved*, ready to disburse.
- **Reject** → with a reason.
- **Counter-offer** → propose a **smaller principal**; the client accepts or
  declines from their portal. If they accept, it becomes *Approved* (awaiting
  your disbursement). If they decline, it's *Rejected*.

### Disburse
Once *Approved*, **disburse** the loan (record method e.g. M-Pesa/cash). This:
- sets the loan **Active**,
- generates the repayment **schedule**,
- reduces your **available capital pool**, and
- makes the loan visible in the borrower's **My Loans**.

---

## 5. Payments & overdue

- **Record a payment** against a loan (M-Pesa, cash, bank). The schedule updates,
  a receipt/transaction is created, and your **collected** total + capital pool update.
- **Overdue** shows loans/instalments past due so you can follow up (and send SMS
  reminders).
- Each payment produces a **receipt** you can print or share.

---

## 6. Capital pool

Your capital pool tracks the money you lend:
- **Available capital** = initial capital − disbursed + collected.
- **Top up capital** (admins) when you add funds.
- **Utilization** shows how much of your capital is currently out on loan.

Disbursing a loan lowers available capital; collecting repayments raises it.

---

## 7. Reports & analytics

- **Analytics / Reports** — portfolio KPIs, Portfolio-at-Risk (PAR), aging,
  collections and disbursement trends.
- **Export** any report to **PDF or Excel**.
- **Exports** page — bulk export clients, loans, payments.

---

## 8. Staff & permissions

**User Management** (admin only) — add staff and assign a role:

| Role | Can do |
|---|---|
| **Admin** | Everything, incl. settings, capital, users |
| **Manager** | Day-to-day operations, approvals |
| **Loan Officer** | Clients, loans, payments |
| **Viewer** | Read-only |

Every action is recorded in the **Audit Log** (who did what, and when).

---

## 9. Communications

- **SMS** and **Email** — send statements, reminders, and bulk messages
  (once your SMS/email provider is configured by the platform).
- Automatic notifications for approvals, payments, and overdue alerts.

---

## 10. Branding & embedding

- **White-label settings** — your logo, brand color, and sender details so the
  borrower portal feels like *your* brand.
- **Embed** — drop a **loan calculator widget** on your own website; visitors can
  calculate and start an application that lands in your queue.

---

## 11. The borrower portal (what your clients see)

Your borrowers get a single LendFest account that works across every lender they
borrow from. They can:
- browse lenders, **link to you**, and apply online,
- track applications and respond to your counter-offers,
- view active loans, schedules, balances, and make payments,
- download statements and see their credit score.

(See the **Borrower User Manual** for their side.)

---

## 12. Quick troubleshooting

| Issue | What to check |
|---|---|
| A client can't log in to the portal | Phone must be saved in `+254…`/`07…` form; share the default password (Section 3) or reset it |
| Loan not showing in client's *My Loans* | It must be **Disbursed (Active)** — approved loans stay in *My Applications* |
| Can't disburse | The loan must be **Approved** first, and you need enough **available capital** |
| Capital pool looks wrong | It updates on disburse/collect; top up if low |
| SMS/Email not sending | The provider must be enabled for your account |

**Need help?** Contact LendFest support from the footer of the site.
