// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { IssueDetailPage } from "./issue-detail-page";

const mobileState = vi.hoisted(() => ({
  value: false,
}));

const derivedState = vi.hoisted(() => ({
  ideaStatus: undefined as string | undefined,
}));

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

const idea: IssueDetail = {
  id: "capture",
  kind: "idea",
  title: "Capture",
  partOf: "issue-tracker",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  labels: [],
};

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("../api/queries", () => ({
  useIssueDetailQuery: () => ({
    data: idea,
    isLoading: false,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: {
      issues: [project, idea],
      derived: {
        capture: { blocked: false, ideaStatus: derivedState.ideaStatus },
      },
    },
  }),
}));

vi.mock("../api/mutations", () => ({
  useUploadAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeletePartialPlan: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/use-issue-detail-file-upload", () => ({
  useIssueDetailFileUpload: () => ({
    rootProps: {},
  }),
}));

vi.mock("./issue-detail-header", () => ({
  IssueDetailHeader: () => <div data-testid="issue-detail-header-inner" />,
}));

vi.mock("./issue-detail-tabs", () => ({
  IssueDetailTabs: ({ overview }: { overview: React.ReactNode }) => (
    <div data-testid="issue-detail-tabs">{overview}</div>
  ),
}));

vi.mock("./issue-meta-panel", () => ({
  IssueMetaPanel: () => null,
}));

vi.mock("./attachments-panel", () => ({
  IssueAttachmentsSection: () => null,
}));

vi.mock("./issue-description-field", () => ({
  IssueDescriptionField: () => null,
}));

vi.mock("./comments/comments-section", () => ({
  IssueCommentsSection: () => null,
}));

function mountPage(
  entry: string | { pathname: string; state?: unknown },
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/projects/:projectId/issues/:id"
            element={<IssueDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function backLink(container: ParentNode): HTMLAnchorElement | null {
  return container.querySelector('[data-testid="issue-detail-back"] a');
}

afterEach(() => {
  document.body.innerHTML = "";
  mobileState.value = false;
  derivedState.ideaStatus = undefined;
});

describe("IssueDetailPage back navigation", () => {
  it("returns to cockpit when opened from the cockpit list", () => {
    const { container } = mountPage({
      pathname: "/projects/issue-tracker/issues/capture",
      state: { issueBackStack: [{ kind: "cockpit" }] },
    });
    const link = backLink(container);
    expect(link).toBeTruthy();
    expect(link!.textContent?.trim()).toBe("Back");
    expect(link!.getAttribute("href")).toBe("/");
  });

  it("falls back to structure when opened without origin state", () => {
    const { container } = mountPage("/projects/issue-tracker/issues/capture");
    const link = backLink(container);
    expect(link).toBeTruthy();
    expect(link!.textContent?.trim()).toBe("Back");
    expect(link!.getAttribute("href")).toBe("/projects/issue-tracker");
  });

  it("returns to agents when opened from the agents surface", () => {
    const { container } = mountPage({
      pathname: "/projects/issue-tracker/issues/capture",
      state: { issueBackStack: [{ kind: "agents" }] },
    });
    const link = backLink(container);
    expect(link).toBeTruthy();
    expect(link!.textContent?.trim()).toBe("Back");
    expect(link!.getAttribute("href")).toBe("/agents");
  });
});

describe("IssueDetailPage mobile channel chrome", () => {
  it("hides back-to-tree and issue header on a mobile channel tab", () => {
    mobileState.value = true;
    const { container } = mountPage(
      "/projects/issue-tracker/issues/capture?tab=planning",
    );
    expect(
      container.querySelector('[data-testid="issue-detail-back"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="issue-detail-header"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="issue-detail-tabs"]'),
    ).toBeTruthy();
  });

  it("keeps issue chrome on mobile Overview", () => {
    mobileState.value = true;
    const { container } = mountPage("/projects/issue-tracker/issues/capture");
    expect(
      container.querySelector('[data-testid="issue-detail-back"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="issue-detail-header"]'),
    ).toBeTruthy();
  });

  it("keeps issue chrome on desktop channel tabs", () => {
    mobileState.value = false;
    const { container } = mountPage(
      "/projects/issue-tracker/issues/capture?tab=planning",
    );
    expect(
      container.querySelector('[data-testid="issue-detail-back"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="issue-detail-header"]'),
    ).toBeTruthy();
  });
});

describe("IssueDetailPage delete partial plan", () => {
  it("shows delete partial plan only for awaiting-direction Ideas", () => {
    derivedState.ideaStatus = "awaiting-direction";
    const awaiting = mountPage("/projects/issue-tracker/issues/capture");
    expect(
      awaiting.container.querySelector(
        '[data-testid="idea-detail-delete-partial-plan"]',
      ),
    ).toBeTruthy();

    document.body.innerHTML = "";
    derivedState.ideaStatus = "captured";
    const captured = mountPage("/projects/issue-tracker/issues/capture");
    expect(
      captured.container.querySelector(
        '[data-testid="idea-detail-delete-partial-plan"]',
      ),
    ).toBeNull();

    document.body.innerHTML = "";
    derivedState.ideaStatus = "planning";
    const planning = mountPage("/projects/issue-tracker/issues/capture");
    expect(
      planning.container.querySelector(
        '[data-testid="idea-detail-delete-partial-plan"]',
      ),
    ).toBeNull();
  });
});
