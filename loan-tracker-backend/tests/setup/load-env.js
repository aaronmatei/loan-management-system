// setupFile — runs in every test worker BEFORE the test file's imports,
// so src/config/database.js builds its Pool against the TEST database.
import { config } from "dotenv";

config({ path: ".env.test" });

const dbName = process.env.DB_NAME || "";
if (!dbName.includes("test")) {
  throw new Error("Refusing to run tests: DB_NAME is not a *_test database!");
}
