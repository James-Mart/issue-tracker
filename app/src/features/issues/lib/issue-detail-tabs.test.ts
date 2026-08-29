import { describe, expect, it } from "vitest";
import type { Issue } from "@server/schemas";
import {
  agentsTabForIssue,
  channelTabForIssue,
  DEFAULT_ISSUE_DETAIL_TAB,
  issueDetailTabNeedsBoundedShell,
  resolveIssueDetailTab,
  tabsForIssueDetail,
  writeIssueDetailTabParam,
} from "./issue-detail-tabs";

const base = {
  id: "x",
  title: "X",
  order: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as const;

const task = {
  ...base,
  kind: "task",
  partOf: "s1",
} satisfies Issue;

const idea = {
  ...base,
  kind: "idea",
  partOf: "p",
} satisfies Issue;

const epic = {
  ...base,
  kind: "epic",
  partOf: "p",
} satisfies Issue;

const projectStory = {
  ...base,
  kind: "story",
  partOf: "p",
} satisfies Issue;

const epicStory = {
  ...base,
  kind: "story",
  partOf: "e1",
} satisfies Issue;

const bareProject = {
  ...base,
  kind: "project",
} satisfies Issue;

const projectWithDocs = {
  ...base,
  kind: "project",
  supportingDocs: {
    vision: { type: "attachment", name: "vision.md" },
    codingStandards: { type: "workspace", path: "docs/standards.md" },
    designSystem: { type: "attachment", name: "design-system.html" },
  },
} satisfies Issue;

describe("channelTabForIssue", () => {
  it("returns planning for Idea and implementing for Epic", () => {
    expect(channelTabForIssue(idea)).toBe("planning");
    expect(channelTabForIssue(epic)).toBe("implementing");
  });

  it("returns implementing only for project-level Stories", () => {
    expect(channelTabForIssue(projectStory, "project")).toBe("implementing");
    expect(channelTabForIssue(epicStory, "epic")).toBeUndefined();
    expect(channelTabForIssue(projectStory)).toBeUndefined();
  });

  it("returns nothing for Task and Project", () => {
    expect(channelTabForIssue(task)).toBeUndefined();
    expect(channelTabForIssue(bareProject)).toBeUndefined();
  });
});

describe("agentsTabForIssue", () => {
  it("returns true for Task and Epic-child Story only", () => {
    expect(agentsTabForIssue(task)).toBe(true);
    expect(agentsTabForIssue(epicStory, "epic")).toBe(true);
    expect(agentsTabForIssue(idea)).toBe(false);
    expect(agentsTabForIssue(epic)).toBe(false);
    expect(agentsTabForIssue(projectStory, "project")).toBe(false);
    expect(agentsTabForIssue(epicStory)).toBe(false);
  });
});

describe("tabsForIssueDetail", () => {
  it("Task: Overview + Agents + Diff", () => {
    expect(tabsForIssueDetail(task).map((t) => t.key)).toEqual([
      "overview",
      "agents",
      "diff",
    ]);
  });

  it("Idea: Overview + Planning", () => {
    expect(tabsForIssueDetail(idea).map((t) => t.key)).toEqual([
      "overview",
      "planning",
    ]);
    expect(tabsForIssueDetail(idea)[1]).toMatchObject({
      key: "planning",
      label: "Planning",
      channel: "planning",
    });
  });

  it("Epic: Overview + Implementing + Diff", () => {
    expect(tabsForIssueDetail(epic).map((t) => t.key)).toEqual([
      "overview",
      "implementing",
      "diff",
    ]);
  });

  it("Story: channel when parent is Project, plus Diff", () => {
    expect(
      tabsForIssueDetail(projectStory, "project").map((t) => t.key),
    ).toEqual(["overview", "implementing", "diff"]);
    expect(tabsForIssueDetail(epicStory, "epic").map((t) => t.key)).toEqual([
      "overview",
      "agents",
      "diff",
    ]);
  });

  it("Project: Overview plus previewable supporting docs", () => {
    expect(tabsForIssueDetail(projectWithDocs).map((t) => t.key)).toEqual([
      "overview",
      "vision",
      "codingStandards",
      "designSystem",
    ]);
  });

  it("Project with no previewable docs: Overview only", () => {
    expect(tabsForIssueDetail(bareProject).map((t) => t.key)).toEqual([
      "overview",
    ]);
  });
});

describe("resolveIssueDetailTab", () => {
  const ideaTabs = tabsForIssueDetail(idea);

  it("defaults absent and unknown values to overview", () => {
    expect(resolveIssueDetailTab(null, ideaTabs)).toBe(DEFAULT_ISSUE_DETAIL_TAB);
    expect(resolveIssueDetailTab("", ideaTabs)).toBe("overview");
    expect(resolveIssueDetailTab("other", ideaTabs)).toBe("overview");
    expect(resolveIssueDetailTab("implementing", ideaTabs)).toBe("overview");
  });

  it("accepts an eligible key", () => {
    expect(resolveIssueDetailTab("planning", ideaTabs)).toBe("planning");
    expect(resolveIssueDetailTab("overview", ideaTabs)).toBe("overview");
    const taskTabs = tabsForIssueDetail(task);
    expect(resolveIssueDetailTab("agents", taskTabs)).toBe("agents");
    expect(resolveIssueDetailTab("diff", taskTabs)).toBe("diff");
  });

  it("falls back when the key is not in this issue's set", () => {
    const taskTabs = tabsForIssueDetail(task);
    expect(resolveIssueDetailTab("planning", taskTabs)).toBe("overview");
  });
});

describe("writeIssueDetailTabParam", () => {
  it("omits the param for the default overview tab", () => {
    const params = new URLSearchParams("tab=planning&x=1");
    expect(writeIssueDetailTabParam(params, "overview").toString()).toBe("x=1");
  });

  it("sets tab for non-default selections", () => {
    const params = new URLSearchParams("x=1");
    expect(writeIssueDetailTabParam(params, "planning").toString()).toBe(
      "x=1&tab=planning",
    );
  });
});

describe("issueDetailTabNeedsBoundedShell", () => {
  it("is true only for the channel tab", () => {
    const ideaTabs = tabsForIssueDetail(idea);
    expect(issueDetailTabNeedsBoundedShell("overview", ideaTabs)).toBe(false);
    expect(issueDetailTabNeedsBoundedShell("planning", ideaTabs)).toBe(true);
  });

  it("is false when the issue has no channel tab", () => {
    const taskTabs = tabsForIssueDetail(task);
    expect(issueDetailTabNeedsBoundedShell("overview", taskTabs)).toBe(false);
    expect(issueDetailTabNeedsBoundedShell("planning", taskTabs)).toBe(false);
  });
});
