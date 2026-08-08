import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaywrightConfig,
  usesAgentStackEnv,
} from "./playwright.config.js";
import { DEFAULT_BASE_URL } from "./scripts/capture-screenshots.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usesAgentStackEnv", () => {
  it("is false when AGENT_STACK_BASE_URL is unset", () => {
    expect(usesAgentStackEnv({})).toBe(false);
  });

  it("is true when AGENT_STACK_BASE_URL is set", () => {
    expect(
      usesAgentStackEnv({ AGENT_STACK_BASE_URL: "http://127.0.0.1:41002" }),
    ).toBe(true);
  });

  it("is false for whitespace-only AGENT_STACK_BASE_URL", () => {
    expect(usesAgentStackEnv({ AGENT_STACK_BASE_URL: "   " })).toBe(false);
  });
});

describe("buildPlaywrightConfig", () => {
  it("defaults smoke baseURL to localhost:8060 and starts webServer", () => {
    const config = buildPlaywrightConfig({});
    expect(config.use?.baseURL).toBe(DEFAULT_BASE_URL);
    expect(config.webServer).toEqual({
      command: "npm run dev",
      url: DEFAULT_BASE_URL,
      reuseExistingServer: true,
    });
  });

  it("uses AGENT_STACK_BASE_URL and skips webServer when set", () => {
    const config = buildPlaywrightConfig({
      AGENT_STACK_BASE_URL: "http://127.0.0.1:41002/",
    });
    expect(config.use?.baseURL).toBe("http://127.0.0.1:41002");
    expect(config.webServer).toBeUndefined();
  });

  it("does not reuse an existing server in CI", () => {
    const config = buildPlaywrightConfig({ CI: "1" });
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
  });
});
