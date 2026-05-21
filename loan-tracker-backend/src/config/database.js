import pkg from "pg";
const { Pool } = pkg;

// Hosted Postgres (Neon/Supabase/etc.) hands you a single DATABASE_URL and
// requires SSL. Locally we use the individual DB_* vars with no SSL.
const useUrl = !!process.env.DATABASE_URL;
// Managed providers use certs that don't chain to a local trust store;
// rejectUnauthorized:false is the standard setting for them.
const ssl = useUrl || process.env.DB_SSL === "true"
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({
  ...(useUrl
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      }),
  ssl,
  max: 20,
  idleTimeoutMillis: 30000,
  // Hosted/serverless Postgres can cold-start; allow more time than local.
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

export default pool;
