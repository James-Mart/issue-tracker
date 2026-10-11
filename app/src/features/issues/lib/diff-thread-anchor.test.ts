import { describe, expect, it } from "vitest";
import { composerDraftKey, newComposerForRange } from "./diff-thread-anchor";

const PATH = "app/server/services/diff-fetch.ts";

describe("newComposerForRange", () => {
  it("anchors a deletion on the pre-rename path", () => {
    expect(
      newComposerForRange(
        { start: 12, end: 12, side: "deletions" },
        { name: "new.ts", prevName: "old.ts" },
      ),
    ).toEqual({ kind: "new", path: "old.ts", side: "old", line: 12 });
  });
});

describe("draft keys and write payloads", () => {
  it("scopes new-thread and reply drafts on different keys", () => {
    const neu = composerDraftKey("story-1", {
      kind: "new",
      path: PATH,
      side: "new",
      line: 94,
    });
    const reply = composerDraftKey("story-1", {
      kind: "reply",
      threadId: "current-root",
    });
    const range = composerDraftKey("story-1", {
      kind: "new",
      path: PATH,
      side: "new",
      line: 96,
      startLine: 94,
    });
    const file = composerDraftKey("story-1", { kind: "new", path: PATH });
    expect(neu).toBe(`review:story-1:line:${PATH}:new:94`);
    expect(reply).toBe("review:story-1:reply:current-root");
    expect(range).toBe(`review:story-1:line:${PATH}:new:94-96`);
    expect(file).toBe(`review:story-1:file:${PATH}`);
    expect(neu).not.toBe(reply);
    expect(file).not.toBe(neu);
  });
});
