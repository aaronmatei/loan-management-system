// Shared constants + DB connection config for the E2E suite.
// setup-db.js seeds exactly these credentials; the specs log in with them.

export const ADMIN = {
  email: "e2e.admin@lendfest.test",
  password: "E2eAdmin1234!",
};

export const TENANT = {
  tenant_code: "E2E",
  business_name: "E2E Lender Ltd",
  // All-letters first 3 chars → code prefix "ELE". Avoids a backend bug
  // where nextScopedCode's [A-Z]+ regex can't parse a digit-containing
  // prefix (e.g. "E2E"), which breaks MAX(suffix) and dup-keys the 2nd row.
  subdomain: "elender",
  contact_name: "E2E Admin",
  contact_email: ADMIN.email,
};

export const E2E_DB = process.env.E2E_DB_NAME || "loan_tracker_e2e";
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 3000);
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 5173);

export function dbConfig(database) {
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database,
  };
}
