// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { ProjectOutlinesTab } from "./project-outlines-tab";

const { list } = vi.hoisted(() => ({
  list: {
    issues: [] as IssueRecord[],
    derived: {} as Record<string, DerivedState>,
  },
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: list.issues, derived: list.derived },
    error: null,
  }),
}));

const t0 = "2026-01-01T00:00:00.000Z";

function outline(
  id: string,
  title: string,
  updatedAt: string,
  bodyVersion: number,
  outOfBand?: boolean,
): IssueRecord {
  return {
    id,
    kind: "outline",
    partOf: "proj",
    title,
    bodyVersion,
    archived: false,
    order: 0,
    createdAt: t0,
    updatedAt,
    ...(outOfBand !== undefined && { outOfBand }),
  };
}

function epic(id: string, outlineId: string, archived = false): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "proj",
    blockedBy: [],
    order: 0,
    archived,
    needsAttention: false,
    attentionReason: null,
    createdAt: t0,
    updatedAt: t0,
    sourceOutline: { outline: outlineId, version: 1 },
  };
}

function Probe() {
  const location = useLocation();
  return (
    <pre data-testid="probe">
      {location.pathname}
      {location.search}
      {JSON.stringify(location.state)}
    </pre>
  );
}

function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter
        initialEntries={["/projects/proj/issues/proj?tab=outlines"]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/issues/:id"
            element={
              <>
                <ProjectOutlinesTab projectId="proj" />
                <Probe />
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
  list.issues = [];
  list.derived = {};
  useIssueUiStore.setState({ showArchived: false });
});

function rowIds(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-testid^='project-outline-row-']")].map(
    (row) => row.getAttribute("data-testid") ?? "",
  );
}

describe("ProjectOutlinesTab", () => {
  it("lists outlines newest first and opens the outline", () => {
    list.issues = [
      outline("old", "Older outline", "2026-02-01T00:00:00.000Z", 9),
      outline("new", "Newer outline", "2026-08-01T00:00:00.000Z", 3),
    ];
    const { container } = mount();
    const rows = [
      ...container.querySelectorAll("[data-testid^='project-outline-row-']"),
    ];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "project-outline-row-new",
      "project-outline-row-old",
    ]);
    expect(rows[0]?.textContent).toContain("Newer outline");
    expect(rows[0]?.textContent).toContain("v3");
    expect(rows[0]?.textContent).toContain("0 roots");
    expect(rows[0]?.getAttribute("href")).toBe("/projects/proj/issues/new");

    act(() => {
      (rows[0] as HTMLAnchorElement).click();
    });
    const probe = container.querySelector("[data-testid='probe']")?.textContent;
    expect(probe).toContain("/projects/proj/issues/new");
    expect(probe).toContain('"search":"?tab=outlines"');
    expect(rows[0]?.textContent).not.toContain("Ready to decompose");
  });

  it("lists implementation and out-of-band outlines apart", () => {
    list.issues = [
      outline("banded", "Legacy portal", "2026-05-01T00:00:00.000Z", 2, true),
      outline("linked", "Already built", "2026-06-01T00:00:00.000Z", 4, true),
      outline("kept", "Archived root", "2026-04-01T00:00:00.000Z", 3, true),
      outline("tracker", "Catalog split", "2026-07-01T00:00:00.000Z", 1, false),
      epic("root", "linked"),
      epic("old-root", "kept", true),
    ];
    list.derived = {
      tracker: { blocked: false, readyToDecompose: true },
      linked: { blocked: false, readyToDecompose: false },
      kept: { blocked: false, readyToDecompose: false },
      banded: { blocked: false, readyToDecompose: false },
    };
    const { container } = mount();
    const implementation = container.querySelector(
      "[data-testid='project-outlines-implementation']",
    );
    const outOfBand = container.querySelector(
      "[data-testid='project-outlines-out-of-band']",
    );
    expect(implementation).not.toBeNull();
    expect(outOfBand).not.toBeNull();
    expect(rowIds(implementation!)).toEqual([
      "project-outline-row-tracker",
      "project-outline-row-linked",
      "project-outline-row-kept",
    ]);
    expect(rowIds(outOfBand!)).toEqual(["project-outline-row-banded"]);

    const header = [
      ...(implementation?.querySelector("[aria-hidden='true']")?.children ?? []),
    ].map((cell) => cell.textContent?.trim());
    expect(header).toEqual(["Title", "Status", "Version", "Linked work", ""]);

    const trackerRow = container.querySelector(
      "[data-testid='project-outline-row-tracker']",
    );
    expect(trackerRow?.textContent).toContain("Ready to decompose");
    expect(trackerRow?.textContent).toContain("v1");
    expect(trackerRow?.textContent).toContain("0 roots");

    const linkedRow = container.querySelector(
      "[data-testid='project-outline-row-linked']",
    );
    expect(linkedRow?.textContent).toContain("1 epic");
    expect(linkedRow?.querySelector("[data-testid='project-outline-ready']")).toBeNull();

    const keptRow = container.querySelector(
      "[data-testid='project-outline-row-kept']",
    );
    expect(keptRow?.textContent).toContain("0 roots");

    const bandedRow = container.querySelector(
      "[data-testid='project-outline-row-banded']",
    );
    expect(bandedRow?.textContent).toContain("0 roots");
    expect(bandedRow?.textContent).not.toContain("GitHub");
    expect(bandedRow?.querySelector("[data-testid='project-outline-ready']")).toBeNull();
  });
});
