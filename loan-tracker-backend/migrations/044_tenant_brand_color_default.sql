-- Rebrand (LoanFix -> LenderFest): the platform default tenant brand color
-- moves from the old indigo (#4F46E5) to LenderFest teal (#0E8A6E).
--
-- 1. New tenants get teal by default.
-- 2. Backfill every tenant still sitting on the old default. The app
--    already treats #4F46E5 as "unset" (see frontend portal/lenderColor.js,
--    whose DEFAULT_BRAND must stay in sync with this value), so this only
--    recolors un-customized tenants — never one that deliberately picked a
--    color.
ALTER TABLE tenants ALTER COLUMN brand_color SET DEFAULT '#0E8A6E';
UPDATE tenants SET brand_color = '#0E8A6E' WHERE brand_color = '#4F46E5';
