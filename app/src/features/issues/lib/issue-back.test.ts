import { describe, expect, it } from "vitest";
import {
  issueBackTo,
  nextIssueBackStack,
  originEntryFromLocation,
  peekIssueBack,
  popIssueBack,
  pushIssueBack,
} from "./issue-back";

describe("originEntryFromLocation", () => {
  it("maps cockpit and structure list routes", () => {
    expect(originEntryFromLocation("/", "")).toEqual({ kind: "cockpit" });
    expect(originEntryFromLocation("/projects/p1", "")).toEqual({
      kind: "structure",
      projectId: "p1",
    });
    expect(originEntryFromLocation("/projects/p1", "?lens=overview")).toEqual({
      kind: "structure",
      projectId: "p1",
    });
    expect(originEntryFromLocation("/projects/p1", "?lens=structure")).toEqual({
      kind: "structure",
      projectId: "p1",
    });
  });

  it("maps pipeline routes with pathname and search", () => {
    expect(originEntryFromLocation("/pipeline", "")).toEqual({
      kind: "pipeline",
      to: "/pipeline",
    });
    expect(originEntryFromLocation("/pipeline", "?pipeline=work")).toEqual({
      kind: "pipeline",
      to: "/pipeline?pipeline=work",
    });
    expect(originEntryFromLocation("/pipeline/runs", "")).toEqual({
      kind: "pipeline",
      to: "/pipeline/runs",
    });
    expect(originEntryFromLocation("/pipeline/runs/conv-1", "")).toEqual({
      kind: "pipeline",
      to: "/pipeline/runs/conv-1",
    });
  });

  it("maps agents", () => {
    expect(originEntryFromLocation("/agents", "")).toEqual({ kind: "agents" });
  });

  it("returns null for issue detail and unrelated routes", () => {
    expect(
      originEntryFromLocation("/projects/p1/issues/story-1", ""),
    ).toBeNull();
    expect(
      originEntryFromLocation("/projects/p1/issues/story-1", "?tab=planning"),
    ).toBeNull();
    expect(originEntryFromLocation("/settings", "")).toBeNull();
  });
});

describe("issueBackTo", () => {
  it("routes cockpit and structure entries", () => {
    expect(issueBackTo({ kind: "cockpit" })).toBe("/");
    expect(issueBackTo({ kind: "structure", projectId: "p1" })).toBe(
      "/projects/p1",
    );
  });

  it("routes pipeline, agents, and issue entries", () => {
    expect(
      issueBackTo({ kind: "pipeline", to: "/pipeline/runs/conv-1" }),
    ).toBe("/pipeline/runs/conv-1");
    expect(issueBackTo({ kind: "agents" })).toBe("/agents");
    expect(
      issueBackTo({ kind: "issue", projectId: "p1", issueId: "story-1" }),
    ).toBe("/projects/p1/issues/story-1");
  });
});

describe("issue back stack helpers", () => {
  const cockpit = { kind: "cockpit" as const };
  const structure = { kind: "structure" as const, projectId: "p1" };
  const onScreenIssue = {
    kind: "issue" as const,
    projectId: "p1",
    issueId: "story-1",
  };

  it("push treats undefined as an empty stack", () => {
    expect(pushIssueBack(undefined, cockpit)).toEqual([cockpit]);
    expect(pushIssueBack([cockpit], structure)).toEqual([cockpit, structure]);
  });

  it("peek returns the last entry", () => {
    expect(peekIssueBack(undefined)).toBeUndefined();
    expect(peekIssueBack([])).toBeUndefined();
    expect(peekIssueBack([cockpit, structure])).toEqual(structure);
  });

  it("pop removes the last entry or returns an empty stack", () => {
    expect(popIssueBack(undefined)).toEqual([]);
    expect(popIssueBack([])).toEqual([]);
    expect(popIssueBack([cockpit, structure])).toEqual([cockpit]);
  });

  it("appends the on-screen issue when navigating from issue detail", () => {
    expect(
      nextIssueBackStack(
        "/projects/p1/issues/story-1",
        "",
        [{ kind: "cockpit" }],
      ),
    ).toEqual([{ kind: "cockpit" }, onScreenIssue]);
  });
});
