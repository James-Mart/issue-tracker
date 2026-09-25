// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { COCKPIT_COLUMN_CLASS, PAGE_SHELL_CLASS } from "./page-shell";

describe("PAGE_SHELL_CLASS", () => {
  it("subtracts the top bar height below shell and uses full viewport at shell", () => {
    const tokens = PAGE_SHELL_CLASS.split(/\s+/);
    expect(tokens).toContain("min-h-[calc(100svh-3rem)]");
    expect(tokens).toContain("shell:min-h-svh");
    expect(tokens).not.toContain("min-h-svh");
  });
});

describe("COCKPIT_COLUMN_CLASS", () => {
  it("centers the column and caps width at design-system content-max", () => {
    const tokens = COCKPIT_COLUMN_CLASS.split(/\s+/);
    expect(tokens).toContain("mx-auto");
    expect(tokens).toContain("w-full");
    expect(tokens).toContain("max-w-[var(--content-max)]");
  });
});
