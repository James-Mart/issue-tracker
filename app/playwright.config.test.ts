import { describe, expect, it } from "vitest";
import { buildPlaywrightConfig } from "./playwright.config.js";

describe("buildPlaywrightConfig", () => {
  it("uses AGENT_STACK_BASE_URL and skips webServer when set", () => {
    const config = buildPlaywrightConfig({
      AGENT_STACK_BASE_URL: "http://127.0.0.1:41002/",
    });
    expect(config.use?.baseURL).toBe("http://127.0.0.1:41002");
    expect(config.webServer).toBeUndefined();
  });
});
