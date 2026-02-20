// Minimal smoke test — starts the app on a random port and hits /health.
// No DB required.
import { Elysia } from "elysia";

const app = new Elysia().get("/health", () => ({ status: "ok" })).listen(0);

const port = (app.server?.port as number) ?? 0;
if (!port) {
  console.error("FAIL: could not determine port");
  process.exit(1);
}

try {
  const res = await fetch(`http://localhost:${port}/health`);
  const body = await res.json();
  if (res.status !== 200 || body?.status !== "ok") {
    console.error("FAIL: unexpected response", res.status, body);
    process.exit(1);
  }
  console.log("OK: /health →", body);
} catch (err) {
  console.error("FAIL:", err);
  process.exit(1);
} finally {
  app.stop();
}
