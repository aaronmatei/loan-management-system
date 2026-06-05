---
name: lenderfest-design-system
description: LenderFest brand tokens/fonts/logo — the `ocean`/`navy` Tailwind names now hold TEAL/INK values, not blue
metadata:
  type: project
---

LenderFest visual identity (shipped commit ddfbab0). Palette: teal `#0E8A6E`
(primary), green `#22B488`, teal-deep `#0A5C4C`, ink `#122A2E`, amber
`#F6A92B` (spark), cream `#FBF7EF`/`#F3ECDD`. Fonts: **Hanken Grotesk**
(body) + **Bricolage Grotesque** (display/wordmark).

**Trap — token names lie:** the Tailwind `ocean-*` ramp and `navy-*` are
the BRAND colors but their NAMES are historical. `ocean` = teal→green
(600 = teal primary, 400 = green, 700 = teal-deep), `navy` = ink. Don't
"fix" `bg-ocean-600` to a blue or assume ocean = blue. Single source of
truth: the `@theme` block in `loan-tracker-frontend/src/index.css`
(Tailwind v4; the JS `tailwind.config.js` is a non-loaded mirror). Remap
values there to re-skin the whole app.

**Logo:** `loan-tracker-frontend/src/components/Logo.jsx` — `<Logo>` (mark
+ wordmark, `variant="reversed"` on dark) and `<LogoMark>` (icon only).
Mark = 3 ascending bars + amber spark. Favicon at `public/favicon.svg`.

**PDF fonts:** embedded TTFs in `loan-tracker-backend/assets/fonts/`;
register via `src/utils/pdfFonts.js` → `registerPdfFonts(doc)` then
`doc.font(FONT.reg|bold|italic|display)`. Call right after `new
PDFDocument()`.

**Tenant brand-color default:** `tenants.brand_color` defaults to
`#0E8A6E` (migration 044). The frontend `portal/lenderColor.js`
`DEFAULT_BRAND` constant MUST stay in sync with that DB default — it's how
the app detects an un-customized tenant. Tenant portals are still
white-labeled on each tenant's own color; the LenderFest tokens are only for
LenderFest's own chrome. See [[rebrand-loanfix-to-lenderfest]].
