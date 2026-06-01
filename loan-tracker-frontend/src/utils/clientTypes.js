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
