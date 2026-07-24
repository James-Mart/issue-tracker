import { describe, expect, it } from "vitest";
import { needsAttentionPatch } from "./needs-attention-patch";

describe("needsAttentionPatch", () => {
  it("sets needsAttention true", () => {
    expect(needsAttentionPatch(true)).toEqual({ needsAttention: true });
  });

  it("clears needsAttention and attentionReason when false", () => {
    expect(needsAttentionPatch(false)).toEqual({
      needsAttention: false,
      attentionReason: null,
    });
  });
});
