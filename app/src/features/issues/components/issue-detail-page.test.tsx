// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const readerState = vi.hoisted(() => ({
  simulateOpen: false,
  override: null as IssueDetail | null,
  loading: false,
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
  version: "1",
  labels: [],
};

const epic: IssueDetail = {
  id: "auth",
  kind: "epic",
  title: "Auth",
  partOf: "issue-tracker",
  blockedBy: [],
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  version: "1",
  labels: [],
  needsAttention: false,
  attentionReason: null,
};

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("../api/queries", () => ({
  useIssueDetailQuery: () => ({
    data: readerState.loading
      ? undefined
      : (readerState.override ?? (readerState.simulateOpen ? epic : idea)),
    isLoading: readerState.loading,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: {
      issues: [project, idea, epic],
      problems: [],
      derived: {
        capture: { blocked: false, ideaStatus: derivedState.ideaStatus },
      },
    },
  }),
  useChannelSessionsQuery: () => ({
    data: [{ id: "existing" }],
    isLoading: false,
    error: null,
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
  IssueDetailTabs: ({
    overview,
    onExportDraftReaderOpenChange,
  }: {
    overview: React.ReactNode;
    onExportDraftReaderOpenChange?: (open: boolean) => void;
  }) => {
    useEffect(() => {
      if (readerState.simulateOpen) {
        onExportDraftReaderOpenChange?.(true);
      }
    }, [onExportDraftReaderOpenChange]);
    return <div data-testid="issue-detail-tabs">{overview}</div>;
  },
}));

vi.mock("./issue-meta-panel", () => ({
  IssueMetaPanel: () => null,
}));

vi.mock("./project-settings-overview", () => ({
  ProjectSettingsOverview: () => null,
}));

vi.mock("./implementing-launch-control", () => ({
  ImplementingOverviewLaunch: () => null,
}));

vi.mock("./export-overview-launch", () => ({
  ExportOverviewLaunch: () => null,
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
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
  readerState.simulateOpen = false;
  readerState.override = null;
  readerState.loading = false;
  document.title = "Issue Tracker";
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

  it("hides issue chrome when a mobile export draft reader is open", () => {
    mobileState.value = true;
    readerState.simulateOpen = true;
    const { container } = mountPage(
      "/projects/issue-tracker/issues/auth?tab=export",
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

describe("IssueDetailPage tab title", () => {
  const projectDetail: IssueDetail = {
    ...project,
    description: "",
    version: "1",
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    supportingDocs: {
      vision: { type: "attachment", name: "vision.md" },
      designSystem: { type: "attachment", name: "design-system.html" },
    },
  };

  function mountTitle(entry: string) {
    document.title = "Issue Tracker";
    return mountPage(entry);
  }

  it("uses the issue title on Overview and the tab label on other tabs", () => {
    const overview = mountTitle("/projects/issue-tracker/issues/capture");
    expect(document.title).toBe("IT: Capture");
    act(() => overview.root.unmount());

    const planning = mountTitle(
      "/projects/issue-tracker/issues/capture?tab=planning",
    );
    expect(document.title).toBe("IT: Capture·Planning");
    act(() => planning.root.unmount());
  });

  it("ignores comment anchors and ineligible tabs", () => {
    const anchored = mountTitle(
      "/projects/issue-tracker/issues/capture?thread=t-1#comment-9",
    );
    expect(document.title).toBe("IT: Capture");
    act(() => anchored.root.unmount());

    const agents = mountTitle(
      "/projects/issue-tracker/issues/capture?tab=agents",
    );
    expect(document.title).toBe("IT: Capture");
    act(() => agents.root.unmount());
  });

  it("uses Doc for a supporting-doc preview tab", () => {
    readerState.override = projectDetail;
    const { root } = mountTitle(
      "/projects/issue-tracker/issues/issue-tracker?tab=vision",
    );
    expect(document.title).toBe("IT: issue-tracker·Doc");
    act(() => root.unmount());

    const design = mountTitle(
      "/projects/issue-tracker/issues/issue-tracker?tab=designSystem",
    );
    expect(document.title).toBe("IT: issue-tracker·Doc");
    act(() => design.root.unmount());
  });

  it("stands in with the URL id until the issue name loads", () => {
    readerState.loading = true;
    const pending = mountTitle(
      "/projects/issue-tracker/issues/capture?tab=diff",
    );
    expect(document.title).toBe("IT: capture·Diff");
    act(() => pending.root.unmount());

    const doc = mountTitle(
      "/projects/issue-tracker/issues/capture?tab=vision",
    );
    expect(document.title).toBe("IT: capture·Doc");
    act(() => doc.root.unmount());
  });
});
