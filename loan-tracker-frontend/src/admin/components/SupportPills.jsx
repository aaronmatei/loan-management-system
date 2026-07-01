import React from "react";
import { AlertTriangle, MessageCircle } from "lucide-react";

// Shared status/priority pills + priority icon for support tickets
// (platform + tenant views). Components only, so fast-refresh stays happy.
const STATUS = {
  open: { c: "#0e8a6e", b: "#e0f4ee" },
  pending: { c: "#d9892a", b: "#fbf0df" },
  resolved: { c: "#16a34a", b: "#e4f5ec" },
  closed: { c: "#8b8aa0", b: "#f0f0f7" },
};
export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.closed;
  return (
    <span className="inline-flex items-center text-[11.5px] font-bold px-2.5 py-1 rounded-lg capitalize" style={{ background: s.b, color: s.c }}>
      {status}
    </span>
  );
}

const PRI = {
  high: { c: "#c0453f", b: "#fbe6e4" },
  normal: { c: "#4b3fce", b: "#ecebfd" },
  low: { c: "#8b8aa0", b: "#f0f0f7" },
};
export function PriorityPill({ priority }) {
  const p = PRI[priority] || PRI.normal;
  return (
    <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-md capitalize" style={{ background: p.b, color: p.c }}>
      {priority}
    </span>
  );
}

export function PriorityIcon({ priority }) {
  const p = PRI[priority] || PRI.normal;
  const Icon = priority === "high" ? AlertTriangle : MessageCircle;
  return (
    <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: p.b, color: p.c }}>
      <Icon size={16} />
    </span>
  );
}
