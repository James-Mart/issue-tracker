// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { ProjectOutlinesTab } from "./project-outlines-tab";

const { list } = vi.hoisted(() => ({
  list: { issues: [] as IssueRecord[] },
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: list.issues, derived: {} },
    error: null,
  }),
}));

function outline(
  id: string,
  title: string,
  updatedAt: string,
  bodyVersion: number,
): IssueRecord {
  return {
    id,
    kind: "outline",
    partOf: "proj",
    title,
    bodyVersion,
    archived: false,
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
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
  useIssueUiStore.setState({ showArchived: false });
});

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
  });
});
