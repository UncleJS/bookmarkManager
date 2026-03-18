// Minimal smoke test — starts the real app on a random port and hits /health and /ready.
// Uses an injected readiness probe so route behavior is verified without a live DB.
import { buildApp } from "../server.ts";

const app = buildApp({
  checkReadiness: async () => {
    return;
  },
}).listen(0);

const port = (app.server?.port as number) ?? 0;
if (!port) {
  console.error("FAIL: could not determine port");
  process.exit(1);
}

try {
  const healthRes = await fetch(`http://localhost:${port}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody?.status !== "ok" || healthBody?.check !== "liveness") {
    console.error("FAIL: unexpected /health response", healthRes.status, healthBody);
    process.exit(1);
  }

  const readyRes = await fetch(`http://localhost:${port}/ready`);
  const readyBody = await readyRes.json();
  if (readyRes.status !== 200 || readyBody?.status !== "ok" || readyBody?.check !== "readiness") {
    console.error("FAIL: unexpected /ready response", readyRes.status, readyBody);
    process.exit(1);
  }

  console.log("OK: /health →", healthBody);
  console.log("OK: /ready  →", readyBody);
} catch (err) {
  console.error("FAIL:", err);
  process.exit(1);
} finally {
  app.stop();
}
