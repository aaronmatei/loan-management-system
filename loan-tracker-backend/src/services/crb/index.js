// CRB (Credit Reference Bureau) adapter layer.
//
// One normalized interface, many providers. The active provider is chosen by
// CRB_PROVIDER (default "manual" — a stub that works today without any bureau
// account). Wire a real bureau (e.g. Metropol) by setting CRB_PROVIDER +
// the provider's credentials; the rest of the app is untouched.
//
// Every provider returns the SAME shape:
//   { provider, source, reference, score, grade, status, accounts, raw }
//   source: "api" (live bureau) | "manual" (officer-keyed) | "estimate" (stub)
//   status: "clear" | "listed" | "defaulted" | "no_hit" | "unknown"
import manual from "./manual.js";
import metropol from "./metropol.js";

const PROVIDERS = { manual, metropol };

export function activeProvider() {
  const name = (process.env.CRB_PROVIDER || "manual").toLowerCase();
  return PROVIDERS[name] || manual;
}

export function crbProviderInfo() {
  const p = activeProvider();
  return { name: p.name, connected: p.isConnected() };
}

// `client` is the borrower row (needs id_number + credit_score). `override`
// carries officer-entered values when the bureau isn't connected.
export async function pullCreditReport({ client, override = null }) {
  return activeProvider().getCreditReport({ client, override });
}
