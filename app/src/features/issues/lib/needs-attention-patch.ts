import type { IssuePatch } from "@server/schemas";

/** Patch shape for toggling needs-attention (clears reason when off). */
export function needsAttentionPatch(needsAttention: boolean): IssuePatch {
  return needsAttention
    ? { needsAttention: true }
    : { needsAttention: false, attentionReason: null };
}
