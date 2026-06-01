// Client type — Individual / Group / Business. Shared by every form
// that creates or edits a client (staff Clients page, onboarding
// FirstClientStep, portal Register) so the option list and human
// labels stay consistent.
import { User, Users, Briefcase } from "lucide-react";

export const CLIENT_TYPES = [
  {
    value: "individual",
    label: "Individual",
    description: "A single borrower",
    icon: User,
  },
  {
    value: "group",
    label: "Group",
    description: "A chama or savings group",
    icon: Users,
  },
  {
    value: "business",
    label: "Business",
    description: "A registered business or SME",
    icon: Briefcase,
  },
];

export const CLIENT_TYPE_VALUES = CLIENT_TYPES.map((t) => t.value);

// Human-friendly label for a stored value (used in tables / chips).
export function clientTypeLabel(value) {
  return CLIENT_TYPES.find((t) => t.value === value)?.label || "Individual";
}

// Returns the appropriate label for the business_name field given a
// client_type. Individuals don't typically have a business name; for
// Group/Business we adapt the wording so the form reads naturally.
export function businessNameLabel(clientType) {
  if (clientType === "group") return "Group Name";
  if (clientType === "business") return "Business Name";
  return "Business Name (optional)";
}

// Derived tags for a client row. ALL derived on read from row data
// the /clients list endpoint returns (status + loan-status counts),
// so there's no stored "tags" column to keep in sync.
//
//   Blacklisted  status === 'blacklisted'  OR  has any defaulted loan
//   VIP          ≥ 3 completed loans (and not blacklisted)
//   Repeat       ≥ 2 completed loans      (and not VIP / blacklisted)
//
// Returns array of { key, label, tone } so callers render chips in
// whatever order/style they want.
export function clientTags(client) {
  const completed = client.completed_loans_count || 0;
  const defaulted = client.defaulted_loans_count || 0;
  const tags = [];
  if (client.status === "blacklisted" || defaulted > 0) {
    tags.push({ key: "blacklisted", label: "Blacklisted", tone: "rose" });
  }
  if (completed >= 3 && client.status !== "blacklisted") {
    tags.push({ key: "vip", label: "VIP", tone: "emerald" });
  } else if (completed >= 2 && client.status !== "blacklisted") {
    tags.push({ key: "repeat", label: "Repeat", tone: "sky" });
  }
  return tags;
}

// Maps the tag tone to Tailwind classes. Kept centralized so any new
// chip surface reuses the same palette without copy-pasting.
export function tagChipClass(tone) {
  switch (tone) {
    case "rose":
      return "bg-rose-100 text-rose-700";
    case "emerald":
      return "bg-emerald-100 text-emerald-700";
    case "sky":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}
