// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileDiffMetadata } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StandardsProposalDiff } from "./review-standards-proposal-diff";

const seen = vi.hoisted(() => ({
  fileDiff: undefined as FileDiffMetadata | undefined,
  options: undefined as { disableLineNumbers?: boolean } | undefined,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    fileDiff,
    options,
  }: {
    fileDiff: FileDiffMetadata;
    options?: typeof seen.options;
  }) => {
    seen.fileDiff = fileDiff;
    seen.options = options;
    return <div data-testid="file-diff" />;
  },
}));

const FILE = [
  "# Coding Standards",
  "",
  "## Implementation",
  "",
  "Be skeptical of defensive code.",
  "",
  "Prefer loud failures.",
  "",
  "Keep the contract explicit.",
  "",
  "Name the boundary.",
  "",
  "### Comments",
  "",
  "Write comments for the next reader.",
  "",
  "## Unit suite",
  "",
  "Working directory is the workspace.",
  "",
  "The clock excludes queue time.",
  "",
  "An assertion failure stays a failure.",
  "",
].join("\n");

let root: Root | undefined;

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  seen.fileDiff = undefined;
  seen.options = undefined;
});

function lineOf(fileDiff: FileDiffMetadata, text: string): number {
  const index = fileDiff.additionLines.findIndex((line) => line.includes(text));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

describe("StandardsProposalDiff", () => {
  it("draws a pure addition at the section end, with the next heading in the hunk", () => {
    render(
      <StandardsProposalDiff
        fileName="coding-standards.md"
        section="Comments"
        before=""
        after="Name a function for its intent."
        fileText={FILE}
      />,
    );
    const fileDiff = seen.fileDiff!;
    const added = lineOf(fileDiff, "Name a function for its intent.");
    const heading = lineOf(fileDiff, "## Unit suite");
    expect(heading).toBe(added + 1);
    const hunk = fileDiff.hunks[0]!;
    const hunkEnd = hunk.additionStart + hunk.additionCount - 1;
    expect(heading).toBeGreaterThanOrEqual(hunk.additionStart);
    expect(heading).toBeLessThanOrEqual(hunkEnd);
    expect(hunk.collapsedBefore).toBeGreaterThan(1);
    expect(fileDiff.additionLines.length).toBeGreaterThan(hunkEnd + 1);
    expect(seen.options?.disableLineNumbers).toBe(false);
  });
});
