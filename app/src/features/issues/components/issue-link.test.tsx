// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueBackLocationState } from "../lib/issue-back";
import { IssueLink } from "./issue-link";

const t0 = "2026-08-01T00:00:00.000Z";

const project = {
  id: "issue-tracker",
  kind: "project" as const,
  title: "issue-tracker",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  labels: [],
  workspace: "/tmp/ws",
};

const storyA = {
  id: "story-a",
  kind: "story" as const,
  title: "Story A",
  partOf: "issue-tracker",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  labels: [],
};

const storyB = {
  id: "story-b",
  kind: "story" as const,
  title: "Story B",
  partOf: "issue-tracker",
  order: 1,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  labels: [],
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: [project, storyA, storyB],
    },
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-stack={JSON.stringify(
        (location.state as IssueBackLocationState | null)?.issueBackStack ?? null,
      )}
    />
  );
}

function IssueDetailBackLink() {
  const location = useLocation();
  const stack = (location.state as IssueBackLocationState | null)?.issueBackStack;
  const backEntry = stack?.[stack.length - 1];
  const backTo =
    backEntry?.kind === "issue"
      ? `/projects/${backEntry.projectId}/issues/${backEntry.issueId}`
      : backEntry?.kind === "cockpit"
        ? "/"
        : "/projects/issue-tracker";
  const remainingStack = stack?.slice(0, -1) ?? [];

  return (
    <a
      href={backTo}
      data-testid="issue-detail-back"
      data-remaining-stack={JSON.stringify(remainingStack)}
    >
      Back
    </a>
  );
}

function mountNavigationTest(
  initialEntry: { pathname: string; state?: IssueBackLocationState },
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/projects/:projectId/issues/:id"
            element={
              <>
                <LocationProbe />
                <IssueDetailBackLink />
                <IssueLink id="story-b">Open Story B</IssueLink>
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("IssueLink issue back stack", () => {
  it("preserves the list origin when hopping to a second issue", async () => {
    const { container } = mountNavigationTest({
      pathname: "/projects/issue-tracker/issues/story-a",
      state: { issueBackStack: [{ kind: "cockpit" }] },
    });

    const link = container.querySelector(
      'a[href="/projects/issue-tracker/issues/story-b"]',
    ) as HTMLAnchorElement;
    expect(link).toBeTruthy();

    await act(async () => {
      link.click();
    });

    const probe = container.querySelector(
      '[data-testid="location-probe"]',
    ) as HTMLElement;
    expect(probe.dataset.pathname).toBe("/projects/issue-tracker/issues/story-b");
    expect(JSON.parse(probe.dataset.stack!)).toEqual([
      { kind: "cockpit" },
      {
        kind: "issue",
        projectId: "issue-tracker",
        issueId: "story-a",
      },
    ]);

    const back = container.querySelector(
      '[data-testid="issue-detail-back"]',
    ) as HTMLElement;
    expect(back.textContent?.trim()).toBe("Back");
    expect(back.getAttribute("href")).toBe(
      "/projects/issue-tracker/issues/story-a",
    );
    expect(JSON.parse(back.dataset.remainingStack!)).toEqual([
      { kind: "cockpit" },
    ]);
  });
});
