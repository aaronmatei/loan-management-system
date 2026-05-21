import React from "react";
import { getPortalBrand } from "../brand";

// Rounded gradient icon tile (lucide icon), themed by the current lender's
// brand_color. Portal-side counterpart of components/IconTile.jsx (which is
// ocean — LoanFix chrome). Keeps the customer portal white-labeled.
export default function BrandTile({ icon: Icon, size = 40, className = "" }) {
  const { gradient } = getPortalBrand();
  return (
    <div
      className={`flex items-center justify-center rounded-xl shadow-sm shrink-0 ${className}`}
      style={{ width: size, height: size, background: gradient }}
    >
      {Icon ? <Icon size={size * 0.5} color="#fff" strokeWidth={2.2} /> : null}
    </div>
  );
}
