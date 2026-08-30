import { describe, expect, it } from "vitest";
import {
  issueBackTo,
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

  it("returns null for issue detail and unrelated routes", () => {
    expect(
      originEntryFromLocation("/projects/p1/issues/story-1", ""),
    ).toBeNull();
    expect(
      originEntryFromLocation("/projects/p1/issues/story-1", "?tab=planning"),
    ).toBeNull();
    expect(originEntryFromLocation("/agents", "")).toBeNull();
  });
});

describe("issueBackTo", () => {
  it("routes cockpit and structure entries", () => {
    expect(issueBackTo({ kind: "cockpit" })).toBe("/");
    expect(issueBackTo({ kind: "structure", projectId: "p1" })).toBe(
      "/projects/p1",
    );
  });
});

describe("issue back stack helpers", () => {
  const cockpit = { kind: "cockpit" as const };
  const structure = { kind: "structure" as const, projectId: "p1" };

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
});
