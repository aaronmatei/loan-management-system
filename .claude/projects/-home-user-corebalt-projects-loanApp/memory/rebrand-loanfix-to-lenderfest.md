---
name: rebrand-loanfix-to-lenderfest
description: Brand is LenderFest (domain lenderfest.loans); 4 loanfix refs are kept ON PURPOSE — do not "finish" the rename
metadata:
  type: project
---

Rebranded **LoanFix → LenderFest** on 2026-06-05 (LoanFix collided with a South
African company). New domain is **lenderfest.loans** (`.loans` TLD, not `.net`),
DNS on Vercel nameservers (ns1/ns2.vercel-dns.com). Display name + all
`loanfix.{net,co.ke,com}` domain literals were migrated to `lenderfest.loans`.

**Four `loanfix` references are intentionally KEPT — do NOT rename them:**
- `render.yaml` service name `loanfix-backend` — Render binds services by name; renaming orphans the live service.
- `utils/secretsCrypto.js` HKDF salt `"loanfix-secrets-crypto-v1"` — changing it makes every stored encrypted secret undecryptable.
- `routes/portal/customer.js` Cloudinary folder `loanfix/kyc/` — existing KYC uploads live there; renaming fragments storage.
- `App.jsx` legacy route `/loanfix/*` (LoanfixLegacyRedirect) — exists to redirect OLD loanfix bookmarks; must stay `/loanfix` to work.

**Why:** A future session greps `loanfix` and "cleans up" the stragglers → breaks crypto / orphans infra.
**How to apply:** Leave those four. Everything else is LenderFest.

Favicon monogram is "LF" — still valid for LenderFest. Related: [[rebrand-pending-infra-steps]].
