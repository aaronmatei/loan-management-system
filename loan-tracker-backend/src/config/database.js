import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
