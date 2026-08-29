import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIFF_LAYOUT,
  effectiveDiffLayout,
  parseDiffLayout,
  readStoredDiffLayout,
  writeStoredDiffLayout,
} from "./diff-layout-preference";

describe("diff-layout-preference", () => {
  it("defaults to unified", () => {
    expect(parseDiffLayout(null)).toBe(DEFAULT_DIFF_LAYOUT);
    expect(parseDiffLayout("")).toBe(DEFAULT_DIFF_LAYOUT);
    expect(parseDiffLayout("garbage")).toBe(DEFAULT_DIFF_LAYOUT);
  });

  it("round-trips split through storage", () => {
    const storage = new Map<string, string>();
    const shim = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };

    expect(readStoredDiffLayout(shim)).toBe("unified");
    writeStoredDiffLayout("split", shim);
    expect(readStoredDiffLayout(shim)).toBe("split");
  });

  it("forces unified at phone width", () => {
    expect(effectiveDiffLayout("split", true)).toBe("unified");
    expect(effectiveDiffLayout("unified", true)).toBe("unified");
    expect(effectiveDiffLayout("split", false)).toBe("split");
  });
});
