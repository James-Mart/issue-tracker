// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage } from "@server/schemas";
import { DiffComposerProvider } from "../components/comments/diff-thread-composer";
import { groupCommentThreads } from "../lib/comment-threads";
import { fileDiffsFromPatch } from "../lib/issue-change-file-diffs";
import { useFileThreadAnnotations } from "./use-file-thread-annotations";

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";
const PATH = "app/server/services/diff-fetch.ts";

const PATCH = [
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -88,4 +92,4 @@",
  " line88",
  " line89",
  "-old90",
  "+new94",
  " line91",
].join("\n");

const FILE = fileDiffsFromPatch(PATCH)[0]!;

function root(id: string, side: "old" | "new", line: number): CommentMessage {
  return {
    id,
    role: "human",
    at: "2026-09-30T12:00:00.000Z",
    body: id,
    anchor: { path: PATH, side, line, commitSha: SHA },
  };
}

let mounts: string[] = [];

/** Holds state the way an open reply composer does; a remount loses it. */
function LineProbe({ line }: { line: string }) {
  const [mountedAs] = useState(() => {
    mounts.push(line);
    return line;
  });
  return <div data-probe={mountedAs} data-line={line} />;
}

function Annotations({ messages }: { messages: CommentMessage[] }) {
  const { annotations } = useFileThreadAnnotations(FILE, groupCommentThreads(messages));
  // Pierre's FileDiff keys each annotation slot by its array index.
  return (
    <>
      {annotations.map((annotation, index) => (
        <LineProbe key={index} line={`${annotation.side}:${annotation.lineNumber}`} />
      ))}
    </>
  );
}

let active: Root | undefined;

function render(messages: CommentMessage[]): HTMLDivElement {
  let container = document.body.querySelector<HTMLDivElement>("#host");
  if (!container) {
    container = document.createElement("div");
    container.id = "host";
    document.body.appendChild(container);
    active = createRoot(container);
  }
  act(() => {
    active!.render(
      <DiffComposerProvider issueId="story-1" commitSha={SHA}>
        <Annotations messages={messages} />
      </DiffComposerProvider>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => active?.unmount());
  active = undefined;
  mounts = [];
  document.body.innerHTML = "";
});

describe("useFileThreadAnnotations", () => {
  it("keeps a line mounted when a thread lands on an earlier line", () => {
    const reply = root("reply-thread", "new", 94);
    render([reply]);
    expect(mounts).toEqual(["additions:94"]);

    const container = render([root("earlier-thread", "old", 90), reply]);

    expect(mounts).toEqual(["additions:94", "deletions:90"]);
    for (const probe of container.querySelectorAll("[data-probe]")) {
      expect(probe.getAttribute("data-probe")).toBe(probe.getAttribute("data-line"));
    }
  });
});
