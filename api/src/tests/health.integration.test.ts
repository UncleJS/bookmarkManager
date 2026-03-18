import { describe, expect, it } from "bun:test";

import { buildApp } from "../server.ts";

describe("health endpoints", () => {
  it("returns liveness without checking the database", async () => {
    const app = buildApp({
      checkReadiness: async () => {
        throw new Error("readiness should not run for /health");
      },
    });

    const res = await app.handle(new Request("http://localhost/health"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", check: "liveness" });
  });

  it("returns readiness when the database probe succeeds", async () => {
    const app = buildApp({
      checkReadiness: async () => {
        return;
      },
    });

    const res = await app.handle(new Request("http://localhost/ready"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", check: "readiness" });
  });

  it("returns 503 when the database probe fails", async () => {
    const app = buildApp({
      checkReadiness: async () => {
        throw new Error("db unavailable");
      },
    });

    const res = await app.handle(new Request("http://localhost/ready"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: "error", check: "readiness" });
  });
});
