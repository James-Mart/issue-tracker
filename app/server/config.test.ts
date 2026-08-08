import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig() {
  return import("./config.js");
}

describe("listenPort", () => {
  it("follows process.env.PORT when NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PORT", "8077");
    const { listenPort } = await loadConfig();
    expect(listenPort).toBe(8077);
  });

  it("defaults to 8061 when PORT is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.PORT;
    const { listenPort } = await loadConfig();
    expect(listenPort).toBe(8061);
  });
});
