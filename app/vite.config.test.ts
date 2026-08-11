import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadViteConfig() {
  const mod = await import("./vite.config.js");
  return mod.default;
}

describe("vite dev server config", () => {
  it("defaults port to 8060 and proxy to localhost:8061", async () => {
    delete process.env.VITE_DEV_PORT;
    delete process.env.VITE_API_PROXY_TARGET;
    const config = await loadViteConfig();
    expect(config.server?.port).toBe(8060);
    expect(config.server?.strictPort).toBe(true);
    expect(config.server?.proxy?.["/api"]).toEqual({
      target: "http://localhost:8061",
      ws: true,
    });
  });

  it("reads VITE_DEV_PORT and VITE_API_PROXY_TARGET when set", async () => {
    vi.stubEnv("VITE_DEV_PORT", "8070");
    vi.stubEnv("VITE_API_PROXY_TARGET", "http://localhost:8071");
    const config = await loadViteConfig();
    expect(config.server?.port).toBe(8070);
    expect(config.server?.proxy?.["/api"]).toEqual({
      target: "http://localhost:8071",
      ws: true,
    });
  });
});
