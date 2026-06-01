-- Loan package allowed-purposes filter.
--
-- A package can pin the set of purposes a customer may pick at apply
-- time — e.g. "Asset Plus" → asset finance only, "Quick Cash 6" →
-- working capital / emergency. Empty array = "any purpose" (legacy
-- behavior; matches the full LOAN_PURPOSES list in the frontend).
--
-- Validation lives at the API layer (routes/packages.js) since the
-- canonical purpose list is a frontend constant; the DB only enforces
-- shape.

ALTER TABLE loan_packages
  ADD COLUMN IF NOT EXISTS allowed_purposes TEXT[] NOT NULL DEFAULT '{}';
