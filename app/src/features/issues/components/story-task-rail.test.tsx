// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { StoryTaskRail } from "./story-task-rail";

const t0 = "2026-07-01T00:00:00.000Z";

const issuesState = vi.hoisted(() => ({
  value: [] as IssueRecord[],
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: issuesState.value, derived: {} },
  }),
}));

function task(
  id: string,
  partOf: string,
  status: Extract<IssueRecord, { kind: "task" }>["status"],
  extras: Partial<Extract<IssueRecord, { kind: "task" }>> = {},
): Extract<IssueRecord, { kind: "task" }> {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: extras.order ?? 0,
    createdAt: t0,
    updatedAt: t0,
    status,
    commits: [],
    ...extras,
  };
}

function idea(id: string, title: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "",
    labels: [],
  };
}

function story(): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: "story-a",
    kind: "story",
    title: "Story A",
    partOf: "epic-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "",
    labels: [],
    merged: false,
    reviewedTasks: [],
  };
}

function mountRail(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/projects/project-a/issues/story-a"]}>
        <Routes>
          <Route
            path="/projects/:projectId/issues/:issueId"
            element={<StoryTaskRail issue={story()} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
  issuesState.value = [];
});

describe("StoryTaskRail", () => {
  it("shows one APPENDED caption on the earliest appended task", () => {
    issuesState.value = [
      task("done-a", "story-a", "done", { order: 0 }),
      task("done-b", "story-a", "done", { order: 1 }),
      task("appended-first", "story-a", "todo", {
        order: 2,
        appended: true,
        title: "First appended",
      }),
      task("appended-second", "story-a", "todo", {
        order: 3,
        appended: true,
        title: "Second appended",
      }),
    ];
    const { container } = mountRail();
    const captions = container.querySelectorAll(
      '[data-testid="story-task-rail-appended-caption"]',
    );
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toBe("Appended");
    expect(container.textContent).toContain("First appended");
    expect(container.textContent).not.toMatch(/Second appended[\s\S]*Appended/);
  });

  it("shows no APPENDED caption when no tasks are appended", () => {
    issuesState.value = [
      task("done-a", "story-a", "done", { order: 0 }),
      task("todo-b", "story-a", "todo", { order: 1 }),
    ];
    const { container } = mountRail();
    expect(
      container.querySelector('[data-testid="story-task-rail-appended-caption"]'),
    ).toBeNull();
  });

  it("renders provenance only for tasks with sourceIdea", () => {
    issuesState.value = [
      idea("idea-pr", "PR feedback — redirect allowlist"),
      task("done-a", "story-a", "done", { order: 0 }),
      task("appended-with-idea", "story-a", "todo", {
        order: 1,
        appended: true,
        sourceIdea: "idea-pr",
        title: "From idea",
      }),
      task("appended-no-idea", "story-a", "todo", {
        order: 2,
        appended: true,
        title: "Merge base only",
      }),
    ];
    const { container } = mountRail();
    const provenance = container.querySelectorAll(
      '[data-testid="task-source-idea"]',
    );
    expect(provenance).toHaveLength(1);
    expect(provenance[0]?.textContent).toContain(
      "from PR feedback — redirect allowlist",
    );
    expect(container.textContent).toContain("Merge base only");
  });

  it("keeps RailNode elements as direct children of Rail", () => {
    issuesState.value = [
      task("done-a", "story-a", "done", { order: 0 }),
      task("appended-a", "story-a", "todo", {
        order: 1,
        appended: true,
      }),
      task("appended-b", "story-a", "todo", {
        order: 2,
        appended: true,
      }),
    ];
    const { container } = mountRail();
    const rail = container.querySelector('[data-testid="story-task-rail"]');
    expect(rail).not.toBeNull();
    const directChildren = Array.from(rail!.children);
    expect(directChildren).toHaveLength(3);
    expect(
      directChildren.every((child) => child.getAttribute("role") === "listitem"),
    ).toBe(true);
  });
});
