import { describe, expect, it } from "vitest";
import { parseConversationMeta } from "./conversation.js";

describe("conversationMetaSchema fork fields", () => {
  const base = {
    id: "fork-chat",
    title: "Fork",
    projectId: "platform",
    model: "composer-2.5",
    createdAt: "2026-07-09T14:00:00.000Z",
    updatedAt: "2026-07-09T14:00:00.000Z",
  };

  it("accepts meta carrying all three fork fields", () => {
    const result = parseConversationMeta({
      ...base,
      forkedFrom: "source-chat",
      forkedAtSeq: 12,
      readOnly: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.forkedFrom).toBe("source-chat");
      expect(result.meta.forkedAtSeq).toBe(12);
      expect(result.meta.readOnly).toBe(true);
    }
  });

  it("accepts meta carrying none of the fork fields", () => {
    const result = parseConversationMeta(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.forkedFrom).toBeUndefined();
      expect(result.meta.forkedAtSeq).toBeUndefined();
      expect(result.meta.readOnly).toBeUndefined();
    }
  });

  it("rejects meta that carries forkedFrom without forkedAtSeq", () => {
    const result = parseConversationMeta({
      ...base,
      forkedFrom: "source-chat",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        "forkedAtSeq is required when forkedFrom is set",
      );
    }
  });

  it("rejects meta that carries forkedAtSeq without forkedFrom", () => {
    const result = parseConversationMeta({
      ...base,
      forkedAtSeq: 12,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        "forkedFrom is required when forkedAtSeq is set",
      );
    }
  });
});
