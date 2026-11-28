import { describe, expect, it } from "vitest";
import {
  outlineDecomposeStart,
  redecomposeFrom,
  type DecomposeRoot,
} from "./decompose-readiness.js";

const closed = (
  version: number,
  extra: Partial<DecomposeRoot> = {},
): DecomposeRoot => ({
  version,
  open: false,
  archived: false,
  ...extra,
});

describe("outlineDecomposeStart", () => {
  it("is ready from the newest closed stamp when the body is newer", () => {
    const roots = [closed(1, { open: true, archived: true }), closed(3)];
    const outline = {
      concludedAt: "2026-08-11T00:00:00.000Z",
      outOfBand: false,
      bodyVersion: 4,
    };
    expect(redecomposeFrom(outline.bodyVersion, roots)).toBe(3);
    expect(outlineDecomposeStart(outline, roots)).toEqual({
      ready: true,
      from: 3,
    });
  });
});
