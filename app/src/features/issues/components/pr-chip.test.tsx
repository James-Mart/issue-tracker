// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import type { PrFacts } from "@server/services/delivery";
import { treeRowTouchChipLabels } from "./issue-tree";
import {
  PrChip,
  prFactsChipLabel,
  resolvePrChip,
  type PrChipModel,
} from "./pr-chip";

const t0 = "2026-08-10T12:00:00.000Z";

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function prFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 12,
    url: "https://github.com/acme/widgets/pull/12",
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergeStateStatus: "CLEAN",
    reviewDecision: "approved",
    checks: { state: "success", failing: 0, pending: 0, total: 3 },
    commentCount: 0,
    comments: [],
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function story(overrides: Partial<Extract<IssueRecord, { kind: "story" }>> = {}) {
  return {
    kind: "story" as const,
    id: "ship-pr",
    title: "Ship PR",
    partOf: "epic",
    order: 0,
    archived: false,
    merged: false,
    createdAt: t0,
    updatedAt: t0,
    ...overrides,
  } satisfies Extract<IssueRecord, { kind: "story" }>;
}

function mountChip(model: PrChipModel): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PrChip model={model} />);
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolvePrChip / PrChip", () => {
  it("renders a draft PR chip", () => {
    const facts = prFacts({
      isDraft: true,
      reviewDecision: null,
      checks: { state: "pending", failing: 0, pending: 2, total: 2 },
    });
    const model = resolvePrChip({
      prUrl: facts.url,
      entry: facts,
      queryFailed: false,
      hasData: true,
    });
    expect(model).toEqual({
      kind: "chip",
      label: "Draft · Pending · No review · 0 comments",
      variant: "warn",
    });
    const container = mountChip(model);
    expect(container.textContent).toBe(prFactsChipLabel(facts));
    expect(container.querySelector('[data-testid="pr-chip"]')).toBeTruthy();
  });

  it("renders a clean PR chip", () => {
    const facts = prFacts();
    const model = resolvePrChip({
      prUrl: facts.url,
      entry: facts,
      queryFailed: false,
      hasData: true,
    });
    expect(model).toEqual({
      kind: "chip",
      label: "Ready · Success · Approved · 0 comments",
      variant: "done",
    });
    expect(mountChip(model).textContent).toBe(
      "Ready · Success · Approved · 0 comments",
    );
  });

  it("renders a commented PR chip", () => {
    const facts = prFacts({ commentCount: 3 });
    const model = resolvePrChip({
      prUrl: facts.url,
      entry: facts,
      queryFailed: false,
      hasData: true,
    });
    expect(model).toEqual({
      kind: "chip",
      label: "Ready · Success · Approved · 3 comments",
      variant: "done",
    });
    expect(mountChip(model).textContent).toBe(
      "Ready · Success · Approved · 3 comments",
    );
  });

  it("renders not-found as PR state unavailable", () => {
    const model = resolvePrChip({
      prUrl: "https://github.com/acme/widgets/pull/12",
      entry: { reason: "not-found" },
      queryFailed: false,
      hasData: true,
    });
    expect(model).toEqual({
      kind: "chip",
      label: "PR state unavailable",
      variant: "secondary",
    });
    expect(mountChip(model).textContent).toBe("PR state unavailable");
  });

  it("renders a failed query as PR state unavailable", () => {
    const model = resolvePrChip({
      prUrl: "https://github.com/acme/widgets/pull/12",
      entry: undefined,
      queryFailed: true,
      hasData: false,
    });
    expect(model).toEqual({
      kind: "chip",
      label: "PR state unavailable",
      variant: "secondary",
    });
    expect(mountChip(model).textContent).toBe("PR state unavailable");
  });

  it("renders none when the Story has no prUrl", () => {
    const model = resolvePrChip({
      prUrl: undefined,
      entry: prFacts(),
      queryFailed: false,
      hasData: true,
    });
    expect(model).toEqual({ kind: "hidden" });
    expect(mountChip(model).querySelector('[data-testid="pr-chip"]')).toBeNull();
  });

  it("renders none before the view has fetched", () => {
    const model = resolvePrChip({
      prUrl: "https://github.com/acme/widgets/pull/12",
      entry: undefined,
      queryFailed: false,
      hasData: false,
    });
    expect(model).toEqual({ kind: "hidden" });
    expect(mountChip(model).querySelector('[data-testid="pr-chip"]')).toBeNull();
  });
});

describe("tree row touch menu PR chip text", () => {
  it("includes the chip text among mirrored chip labels", () => {
    const facts = prFacts({
      isDraft: true,
      reviewDecision: null,
      checks: { state: "pending", failing: 0, pending: 2, total: 2 },
    });
    const prChip = resolvePrChip({
      prUrl: facts.url,
      entry: facts,
      queryFailed: false,
      hasData: true,
    });
    const label = prFactsChipLabel(facts);
    const labels = treeRowTouchChipLabels(
      story({ prUrl: facts.url }),
      { storyStatus: "in-progress", blocked: false },
      [],
      prChip,
    );
    expect(labels).toContain(label);
  });

  it("omits PR chip text when the chip is hidden", () => {
    const labels = treeRowTouchChipLabels(story(), undefined, [], {
      kind: "hidden",
    });
    expect(labels).toEqual([]);
  });
});
