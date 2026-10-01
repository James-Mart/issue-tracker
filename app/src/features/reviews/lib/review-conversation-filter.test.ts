import { describe, expect, it } from "vitest";
import {
  conversationFilterCounts,
  conversationFilterIsDefault,
  conversationThreadFilterKey,
  DEFAULT_CONVERSATION_FILTER,
  filterConversationTimeline,
  parseConversationFilter,
} from "./review-conversation-filter";

describe("parseConversationFilter", () => {
  it("uses the default when nothing is stored", () => {
    const parsed = parseConversationFilter(null);
    expect(parsed).toEqual(DEFAULT_CONVERSATION_FILTER);
    expect(parsed).not.toBe(DEFAULT_CONVERSATION_FILTER);
    expect(conversationFilterIsDefault(DEFAULT_CONVERSATION_FILTER)).toBe(true);
  });

  it("reads a stored selection", () => {
    const filter = parseConversationFilter(
      JSON.stringify({
        comments: false,
        resolved: true,
        questions: false,
        dismissed: true,
      }),
    );
    expect(filter).toEqual({
      comments: false,
      resolved: true,
      questions: false,
      dismissed: true,
    });
    expect(conversationFilterIsDefault(filter)).toBe(false);
  });

  it("falls back to the default when the stored value is unreadable", () => {
    expect(parseConversationFilter("{")).toEqual(DEFAULT_CONVERSATION_FILTER);
    expect(parseConversationFilter("[]")).toEqual(DEFAULT_CONVERSATION_FILTER);
    expect(
      parseConversationFilter(
        JSON.stringify({ comments: "yes", resolved: true, questions: true, dismissed: false }),
      ),
    ).toEqual(DEFAULT_CONVERSATION_FILTER);
  });
});

describe("conversationThreadFilterKey", () => {
  it("puts open review threads and story notes on Comments, and resolved threads on Resolved", () => {
    expect(conversationThreadFilterKey({ kind: "review", state: "open" })).toBe(
      "comments",
    );
    expect(conversationThreadFilterKey({ kind: "review", state: "resolved" })).toBe(
      "resolved",
    );
  });

  it("puts open questions on Questions and dismissed questions on Dismissed", () => {
    expect(conversationThreadFilterKey({ kind: "question", state: "open" })).toBe(
      "questions",
    );
    expect(conversationThreadFilterKey({ kind: "question", state: "dismissed" })).toBe(
      "dismissed",
    );
  });
});

describe("filterConversationTimeline", () => {
  const note = { kind: "thread" as const, thread: { kind: "review" as const, state: "open" as const } };
  const resolved = {
    kind: "thread" as const,
    thread: { kind: "review" as const, state: "resolved" as const },
  };
  const question = {
    kind: "thread" as const,
    thread: { kind: "question" as const, state: "open" as const },
  };
  const dismissed = {
    kind: "thread" as const,
    thread: { kind: "question" as const, state: "dismissed" as const },
  };
  const submitted = { kind: "submitted" as const };

  it("counts each thread once and ignores submissions", () => {
    expect(
      conversationFilterCounts([note, note, resolved, question, dismissed, submitted]),
    ).toEqual({ comments: 2, resolved: 1, questions: 1, dismissed: 1 });
  });

  it("hides dismissed questions by default and always keeps submissions", () => {
    expect(
      filterConversationTimeline(
        [note, resolved, question, dismissed, submitted],
        DEFAULT_CONVERSATION_FILTER,
      ),
    ).toEqual([note, resolved, question, submitted]);
  });

  it("keeps a submission when every chip is off", () => {
    expect(
      filterConversationTimeline([dismissed, submitted], {
        comments: false,
        resolved: false,
        questions: false,
        dismissed: false,
      }),
    ).toEqual([submitted]);
  });
});
