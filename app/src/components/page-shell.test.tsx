// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PAGE_SHELL_CLASS } from "./page-shell";

describe("PAGE_SHELL_CLASS", () => {
  it("subtracts the top bar height below shell and uses full viewport at shell", () => {
    const tokens = PAGE_SHELL_CLASS.split(/\s+/);
    expect(tokens).toContain("min-h-[calc(100svh-3rem)]");
    expect(tokens).toContain("shell:min-h-svh");
    expect(tokens).not.toContain("min-h-svh");
  });
});
