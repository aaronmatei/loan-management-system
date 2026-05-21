// Smoke test: no DB required. Proves the ESM + Jest + Supertest harness
// can import the real Express app and serve a request.
import request from "supertest";
import app from "../src/app.js";
import pool from "../src/config/database.js";

afterAll(async () => {
  // app.js imports config/database.js, which constructs a pg Pool. Close it
  // so Jest doesn't report an open handle / hang.
  await pool.end();
});

describe("GET /health", () => {
  it("returns 200 with status OK and the test environment", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "OK",
      environment: "test",
    });
  });

  it("returns 404 with a helpful body for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Endpoint not found");
  });
});
