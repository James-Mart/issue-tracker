// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProjectSidebar } from "./project-sidebar";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../hooks/use-route-project-id", () => ({
  useRouteProjectId: () => null,
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: [] },
  }),
}));

vi.mock("../store/use-issue-ui-store", () => ({
  useIssueUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openProjectDialog: vi.fn(),
      requestDelete: vi.fn(),
    }),
}));

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location-probe">{pathname}</div>;
}

function mountSidebar(
  entry: string,
  sidebarOpen = true,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <SidebarProvider open={sidebarOpen}>
          <ProjectSidebar />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function navLink(container: ParentNode, label: string): HTMLAnchorElement {
  const match = Array.from(container.querySelectorAll("a")).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLAnchorElement)) {
    throw new Error(`Missing nav link: ${label}`);
  }
  return match;
}

function navButton(container: ParentNode, label: string): HTMLElement {
  const link = navLink(container, label);
  const button = link.closest('[data-sidebar="menu-button"]');
  if (!(button instanceof HTMLElement)) {
    throw new Error(`Missing nav button for: ${label}`);
  }
  return button;
}

beforeEach(() => {
  document.cookie = "sidebar_projects_section_open=; path=/; max-age=0";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectSidebar pipeline destination", () => {
  it("renders Pipeline at expanded width with href /pipeline", () => {
    const { container } = mountSidebar("/");
    expect(navLink(container, "Pipeline").getAttribute("href")).toBe("/pipeline");
  });

  it("renders Pipeline at collapsed width", () => {
    const { container } = mountSidebar("/", false);
    expect(navLink(container, "Pipeline").getAttribute("href")).toBe("/pipeline");
  });

  it("navigates to /pipeline when Pipeline is activated", () => {
    const { container } = mountSidebar("/");
    act(() => {
      navLink(container, "Pipeline").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline");
  });

  it("marks Pipeline selected on /pipeline/runs/:conversationId", () => {
    const { container } = mountSidebar("/pipeline/runs/conv-abc");
    expect(navButton(container, "Pipeline").getAttribute("data-active")).toBe(
      "true",
    );
  });

  it("marks Pipeline selected on /pipeline/runs", () => {
    const { container } = mountSidebar("/pipeline/runs");
    expect(navButton(container, "Pipeline").getAttribute("data-active")).toBe(
      "true",
    );
  });
});
