import { describe, expect, it } from "vitest";
import {
  commentInputForComposer,
  composerDraftKey,
  newThreadDraftId,
  pathForAnchorSide,
  selectedRangeToAnchor,
  threadDraftKey,
} from "./diff-thread-anchor";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";
const PATH = "app/server/services/diff-fetch.ts";

describe("selectedRangeToAnchor", () => {
  it("maps a single addition line", () => {
    expect(
      selectedRangeToAnchor(
        { start: 94, end: 94, side: "additions" },
        PATH,
        SHA,
      ),
    ).toEqual({ path: PATH, side: "new", line: 94, commitSha: SHA });
  });

  it("maps a same-side range onto startLine + line", () => {
    expect(
      selectedRangeToAnchor(
        { start: 94, end: 96, side: "additions" },
        PATH,
        SHA,
      ),
    ).toEqual({
      path: PATH,
      side: "new",
      line: 96,
      startLine: 94,
      commitSha: SHA,
    });
  });

  it("normalizes an upward drag so startLine is the lower line", () => {
    expect(
      selectedRangeToAnchor(
        { start: 96, end: 94, side: "additions" },
        PATH,
        SHA,
      ),
    ).toEqual({
      path: PATH,
      side: "new",
      line: 96,
      startLine: 94,
      commitSha: SHA,
    });
  });

  it("drops startLine when the range crosses sides", () => {
    expect(
      selectedRangeToAnchor(
        {
          start: 90,
          end: 94,
          side: "deletions",
          endSide: "additions",
        },
        PATH,
        SHA,
      ),
    ).toEqual({ path: PATH, side: "new", line: 94, commitSha: SHA });
  });
});

describe("pathForAnchorSide", () => {
  it("uses prevName on the old side of a rename", () => {
    expect(
      pathForAnchorSide({ name: "new.ts", prevName: "old.ts" }, "old"),
    ).toBe("old.ts");
    expect(
      pathForAnchorSide({ name: "new.ts", prevName: "old.ts" }, "new"),
    ).toBe("new.ts");
  });
});

describe("draft keys and write payloads", () => {
  it("scopes new-thread and reply drafts on different keys", () => {
    const neu = composerDraftKey({
      kind: "new",
      path: PATH,
      side: "new",
      line: 94,
    });
    const reply = composerDraftKey({ kind: "reply", threadId: "current-root" });
    expect(neu).toBe(
      threadDraftKey("new", newThreadDraftId({ path: PATH, side: "new", line: 94 })),
    );
    expect(reply).toBe(threadDraftKey("reply", "current-root"));
    expect(neu).not.toBe(reply);
  });

  it("builds a single-line anchor post and a reply with no anchor", () => {
    expect(
      commentInputForComposer(
        { kind: "new", path: PATH, side: "new", line: 94 },
        "single",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "single",
      anchor: { path: PATH, side: "new", line: 94, commitSha: SHA },
    });
    expect(
      commentInputForComposer(
        {
          kind: "new",
          path: PATH,
          side: "new",
          line: 96,
          startLine: 94,
        },
        "range",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "range",
      anchor: {
        path: PATH,
        side: "new",
        line: 96,
        startLine: 94,
        commitSha: SHA,
      },
    });
    expect(
      commentInputForComposer(
        { kind: "reply", threadId: "current-root" },
        "reply body",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "reply body",
      replyTo: "current-root",
    });
  });
});
