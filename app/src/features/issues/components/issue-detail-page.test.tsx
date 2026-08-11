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
    data: { issues: [project, idea] },
  }),
}));

vi.mock("../api/mutations", () => ({
  useUploadAttachment: () => ({
    mutateAsync: vi.fn(),
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
  IssueDetailTabs: () => <div data-testid="issue-detail-tabs" />,
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

function mountPage(entry: string): { container: HTMLDivElement; root: Root } {
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

afterEach(() => {
  document.body.innerHTML = "";
  mobileState.value = false;
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
