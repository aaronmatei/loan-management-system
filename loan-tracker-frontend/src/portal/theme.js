// Shared class strings for the warm "Borrower Portal" design language
// (design: Borrower Portal.dc.html). Surfaces are fixed, neutral chrome —
// cream canvas + soft warm borders; accent colours stay per-lender via the
// `--brand` CSS var each page sets on its wrapper. Compose these with
// Tailwind arbitrary utilities in the pages so the look stays consistent.
export const CARD =
  "bg-surface border border-[#ece6da] dark:border-slate-700 rounded-[18px]";
export const CARD_LG =
  "bg-surface border border-[#ece6da] dark:border-slate-700 rounded-[22px]";
// Ink + muted text on the warm canvas.
export const INK = "text-[#16241d] dark:text-slate-100";
export const MUTED = "text-[#8a8170] dark:text-slate-400";
// Small all-caps section/field label.
export const LABEL =
  "text-[11px] font-bold uppercase tracking-[0.04em] text-[#a39b8b] dark:text-slate-500";
// Hairline divider on the warm surfaces.
export const DIVIDE = "border-[#f0ebe0] dark:border-slate-700";

// Soft warm pill (status chips). Pass Tailwind bg/text via `tone`.
export const PILL =
  "inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2.5 py-1 rounded-lg";
