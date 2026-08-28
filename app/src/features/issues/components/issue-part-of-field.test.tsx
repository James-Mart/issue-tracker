// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { IssuePartOfField } from "./issue-part-of-field";

const go = vi.fn();
const mutateAsync = vi.fn();
const moveStory = vi.fn();

vi.mock("./issue-link", () => ({
  IssueLink: ({
    id,
    children,
  }: {
    id: string;
    children: React.ReactNode;
  }) => (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        go(id);
      }}
    >
      {children}
    </a>
  ),
  useIssueLinkNavigate: () => ({
    go,
    hrefFor: (id: string) => `#${id}`,
  }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync }),
  useMoveStory: () => ({ mutateAsync: moveStory }),
}));

vi.mock("./part-of-target-select", () => ({
  PartOfTargetSelect: () => <div data-testid="parent-select" />,
}));

const t0 = "2026-08-10T12:00:00.000Z";

const project = {
  kind: "project" as const,
  id: "platform",
  title: "Platform",
  mergePolicy: "manual" as const,
  order: 0,
  createdAt: t0,
  updatedAt: t0,
};

const epicRecord = {
  kind: "epic" as const,
  id: "auth-epic",
  title: "Add authentication",
  partOf: "platform",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: [project, epicRecord],
    },
  }),
}));

function epicIssue(): Extract<IssueDetail, { kind: "epic" }> {
  return {
    ...epicRecord,
    description: "",
    labels: [],
    version: "v1",
    blockedBy: [],
    attentionReason: null,
  };
}

function storyIssue(): Extract<IssueDetail, { kind: "story" }> {
  return {
    kind: "story",
    id: "login-story",
    title: "Login form",
    partOf: "auth-epic",
    order: 0,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    labels: [],
    version: "v1",
    merged: false,
    reviewedTasks: [],
    attentionReason: null,
  };
}

function taskIssue(): Extract<IssueDetail, { kind: "task" }> {
  return {
    kind: "task",
    id: "wire-form",
    title: "Wire the form",
    partOf: "login-story",
    order: 0,
    archived: false,
    needsAttention: false,
    status: "todo",
    createdAt: t0,
    updatedAt: t0,
    description: "",
    labels: [],
    version: "v1",
    attentionReason: null,
  };
}

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  go.mockReset();
  mutateAsync.mockReset();
  moveStory.mockReset();
});

describe("IssuePartOfField", () => {
  it("shows the parent title and puts the pencil immediately after it", () => {
    const { container } = mount(<IssuePartOfField issue={epicIssue()} />);
    const link = container.querySelector("a");
    const pencil = container.querySelector(
      '[aria-label="Edit parent issue"]',
    );

    expect(container.textContent).toContain("Platform");
    expect(container.textContent).not.toContain("platform");
    expect(link?.textContent).toBe("Platform");
    expect(pencil).toBeTruthy();
    expect(link?.nextElementSibling).toBe(pencil);
    expect(link?.parentElement?.className).toMatch(/flex-wrap/);
    expect(
      container.querySelector('[title="Open platform"]'),
    ).toBeNull();
  });

  it("navigates when the title is clicked and does not enter edit", async () => {
    const { container } = mount(<IssuePartOfField issue={epicIssue()} />);
    const link = container.querySelector("a") as HTMLAnchorElement;

    await act(async () => {
      link.click();
    });

    expect(go).toHaveBeenCalledWith("platform");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[aria-label="Edit parent issue"]')).toBeTruthy();
  });

  it("opens the parent edit from the pencil", async () => {
    const { container } = mount(<IssuePartOfField issue={epicIssue()} />);
    const pencil = container.querySelector(
      '[aria-label="Edit parent issue"]',
    ) as HTMLButtonElement;

    await act(async () => {
      pencil.click();
    });

    expect(container.querySelector("input")).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
  });

  it("opens the story parent picker from the pencil", async () => {
    const { container } = mount(<IssuePartOfField issue={storyIssue()} />);

    expect(container.textContent).toContain("Add authentication");

    const pencil = container.querySelector(
      '[aria-label="Edit parent issue"]',
    ) as HTMLButtonElement;
    await act(async () => {
      pencil.click();
    });

    expect(container.querySelector("[data-testid=parent-select]")).toBeTruthy();
    expect(container.textContent).toContain("Cancel");
    expect(container.querySelector('[aria-label="Edit parent issue"]')).toBeNull();
  });

  it("falls back to the parent id when no title is loaded", () => {
    const { container } = mount(<IssuePartOfField issue={taskIssue()} />);

    expect(container.textContent).toContain("login-story");
    expect(container.querySelector("a")?.textContent).toBe("login-story");
  });

  it("rejects an empty parent with Parent issue wording", async () => {
    const { container } = mount(<IssuePartOfField issue={epicIssue()} />);
    const pencil = container.querySelector(
      '[aria-label="Edit parent issue"]',
    ) as HTMLButtonElement;

    await act(async () => {
      pencil.click();
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      nativeSetter.call(input, "   ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(container.textContent).toContain("Parent issue cannot be empty");
    expect(container.textContent).not.toContain("Part of");
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
