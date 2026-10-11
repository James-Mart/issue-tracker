import { describe, expect, it } from "vitest";
import { decideBrowserNavigation, NO_LIVE_STACK_NAVIGATION_ERROR } from "./browser-origin-allowlist.js";

const BASE = "http://psibase.localhost:41234/";

describe("decideBrowserNavigation", () => {
  it("refuses hosts that are not subdomains of the stack host", () => {
    expect(
      decideBrowserNavigation("http://notpsibase.localhost:41234/", BASE)
        .allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation("http://psibase.localhost.evil:41234/", BASE)
        .allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation("https://psibase.localhost:41234/", BASE).allowed,
    ).toBe(false);
  });

  it("refuses every navigation when there is no live stack", () => {
    for (const target of [
      "http://psibase.localhost:41234/",
      "http://tokens.psibase.localhost:41234/",
      "example.com",
      "http://example.com/",
    ]) {
      expect(decideBrowserNavigation(target, null)).toEqual({
        allowed: false,
        message: NO_LIVE_STACK_NAVIGATION_ERROR,
      });
    }
    expect(NO_LIVE_STACK_NAVIGATION_ERROR).toMatch(/agent_stack_start/);
  });
});
