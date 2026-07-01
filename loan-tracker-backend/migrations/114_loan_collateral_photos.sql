-- Borrowers can attach photos of the collateral they describe when applying for
-- a loan from the customer portal. Stored as a JSON array of image URLs on the
-- loan, alongside collateral_description. Optional (null when none uploaded).
ALTER TABLE loans ADD COLUMN IF NOT EXISTS collateral_photos jsonb;
