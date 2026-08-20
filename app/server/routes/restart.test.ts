import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTART_SUPERVISED_ENV_VAR } from "../restart-contract.js";

let server: Server;
let baseUrl: string;
let initiateRestart: ReturnType<typeof vi.fn>;

async function startApp(): Promise<void> {
  vi.resetModules();
  const { createApp } = await import("../app.js");
  const app = createApp(undefined, initiateRestart);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

beforeEach(() => {
  initiateRestart = vi.fn();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("POST /api/restart", () => {
  it("accepts when supervised and calls initiateRestart after the response", async () => {
    vi.stubEnv(RESTART_SUPERVISED_ENV_VAR, "1");
    await startApp();

    const res = await fetch(`${baseUrl}/api/restart`, { method: "POST" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.bootId).toEqual(expect.any(String));
    expect(body.bootId.length).toBeGreaterThan(0);
    expect(initiateRestart).toHaveBeenCalledOnce();
  });

  it("refuses when unsupervised and never calls initiateRestart", async () => {
    await startApp();

    const res = await fetch(`${baseUrl}/api/restart`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "not-supervised" });
    expect(initiateRestart).not.toHaveBeenCalled();
  });
});
