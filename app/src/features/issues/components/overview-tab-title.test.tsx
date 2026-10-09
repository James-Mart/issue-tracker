// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { OverviewPage } from "./overview-page";

const PROJECT = "issue-tracker";
const t0 = "2026-08-01T00:00:00.000Z";

const state = vi.hoisted(() => ({
  loading: false,
  issues: [] as IssueRecord[],
}));

vi.mock("./issue-tree", () => ({
  IssueTree: () => <div data-testid="issue-tree" />,
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: state.loading
      ? undefined
      : { issues: state.issues, problems: [], derived: {} },
    isLoading: state.loading,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useIssueDetailQuery: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../api/mutations", () => ({
  useUploadAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function project(title: string): IssueRecord {
  return {
    id: PROJECT,
    kind: "project",
    title,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

let root: Root | undefined;

function mount(search = ""): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const entry = `/projects/${PROJECT}${search}`;
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/projects/:projectId" element={<OverviewPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.title = "Issue Tracker";
  state.loading = false;
  state.issues = [];
});

describe("OverviewPage tab title", () => {
  it("uses the project name on Structure and adds Overview on that lens", () => {
    state.issues = [project("issue-tracker")];
    mount();
    expect(document.title).toBe("IT: issue-tracker");

    act(() => root?.unmount());
    mount("?lens=overview");
    expect(document.title).toBe("IT: issue-track\u2026\u00B7Overview");
  });

  it("uses the project id until the name loads", () => {
    state.loading = true;
    mount("?lens=overview");
    expect(document.title).toBe("IT: issue-track\u2026\u00B7Overview");

    act(() => root?.unmount());
    state.loading = false;
    state.issues = [];
    mount();
    expect(document.title).toBe("IT: issue-tracker");
  });

  it("ignores an unknown lens", () => {
    state.issues = [project("Tracker")];
    mount("?lens=flow");
    expect(document.title).toBe("IT: Tracker");
  });
});
