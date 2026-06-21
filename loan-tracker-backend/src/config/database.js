import pkg from "pg";
const { Pool } = pkg;

console.log("DATABASE_URL present?", !!process.env.DATABASE_URL);
console.log("DATABASE_URL length:", (process.env.DATABASE_URL || "").length);

// Hosted Postgres (Neon/Supabase/etc.) hands you a single DATABASE_URL and
// requires SSL. Locally we use the individual DB_* vars with no SSL.
const useUrl = !!process.env.DATABASE_URL;

// Fail fast in production instead of silently trying localhost
if (process.env.NODE_ENV === "production" && !useUrl) {
  throw new Error(
    "DATABASE_URL is not set in production — refusing to fall back to localhost",
  );
}

// Neon / hosted PG require SSL; local Postgres does not.
const ssl = useUrl ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  ...(useUrl
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432"),
        database: process.env.DB_NAME || "loan_tracker",
        user: process.env.DB_USER || "aron",
        password: process.env.DB_PASSWORD || undefined,
      }),
  ssl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: useUrl ? 10000 : 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

export async function connectDB() {
  try {
    const client = await pool.connect();
    console.log("✓ Database connected");
    client.release();
  } catch (err) {
    console.error("✗ Database connection failed:", err);
    process.exit(1);
  }
}

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      console.log("Slow query detected", {
        text,
        duration,
        rows: result.rowCount,
      });
    }
    return result;
  } catch (error) {
    console.error("Database error:", error);
    throw error;
  }
}

// Run `fn` inside a single DB transaction on a dedicated client. `fn(client)`
// must issue ALL its writes on the passed client. Commits on success, rolls
// back on any throw — the one place multi-statement money operations become
// atomic. Use with `pg_advisory_xact_lock` for serialized running balances.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
