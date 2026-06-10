// Metropol CRB (Kenya) adapter — SCAFFOLD.
//
// Inactive until the env credentials are present. The real Metropol "CRB API"
// (a.k.a. Crystobol / Metropol REST) takes a national ID + ID type, is signed
// with an API key/secret, and returns a credit score plus a delinquency
// summary. The exact call is left as a TODO so wiring it later is a drop-in —
// just map the bureau response into the normalized shape and return it.
//
// To activate:
//   CRB_PROVIDER=metropol
//   METROPOL_API_URL, METROPOL_API_KEY, METROPOL_USERNAME, METROPOL_PASSWORD
import { gradeForScore } from "./manual.js";

const name = "metropol";
const isConnected = () =>
  !!(process.env.METROPOL_API_URL && process.env.METROPOL_API_KEY);

async function getCreditReport({ client }) {
  if (!isConnected()) {
    throw Object.assign(
      new Error(
        "Metropol CRB is not configured. Set METROPOL_API_URL, METROPOL_API_KEY, METROPOL_USERNAME and METROPOL_PASSWORD, then CRB_PROVIDER=metropol.",
      ),
      { status: 503 },
    );
  }

  // TODO — wire the real call. Sketch:
  //   const res = await fetch(`${process.env.METROPOL_API_URL}/...`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json", ...metropolAuthHeaders() },
  //     body: JSON.stringify({ identity_number: client.id_number, identity_type: "001" }),
  //   });
  //   const data = await res.json();
  //   return {
  //     provider: "metropol",
  //     source: "api",
  //     reference: data.report_reference,
  //     score: data.credit_score,
  //     grade: gradeForScore(data.credit_score),
  //     status: mapDelinquency(data),     // clear | listed | defaulted
  //     accounts: data.accounts || [],
  //     raw: data,
  //   };
  void gradeForScore; // referenced above when wired
  throw Object.assign(
    new Error("Metropol adapter is configured but not yet wired."),
    { status: 501 },
  );
}

export default { name, isConnected, getCreditReport };
