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

describe("ProjectSidebar pipeline destinations", () => {
  it("renders Pipelines at expanded width with href /pipelines", () => {
    const { container } = mountSidebar("/");
    expect(navLink(container, "Pipelines").getAttribute("href")).toBe("/pipelines");
  });

  it("renders Runs at expanded width with href /runs", () => {
    const { container } = mountSidebar("/");
    expect(navLink(container, "Runs").getAttribute("href")).toBe("/runs");
  });

  it("renders Pipelines and Runs at collapsed width", () => {
    const { container } = mountSidebar("/", false);
    expect(navLink(container, "Pipelines").getAttribute("href")).toBe("/pipelines");
    expect(navLink(container, "Runs").getAttribute("href")).toBe("/runs");
  });

  it("navigates to /pipelines when Pipelines is activated", () => {
    const { container } = mountSidebar("/");
    act(() => {
      navLink(container, "Pipelines").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines");
  });

  it("navigates to /runs when Runs is activated", () => {
    const { container } = mountSidebar("/");
    act(() => {
      navLink(container, "Runs").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs");
  });

  it("marks Pipelines selected on /pipelines", () => {
    const { container } = mountSidebar("/pipelines");
    expect(navButton(container, "Pipelines").getAttribute("data-active")).toBe(
      "true",
    );
    expect(navButton(container, "Runs").getAttribute("data-active")).not.toBe(
      "true",
    );
  });

  it("marks Runs selected on /runs/:conversationId", () => {
    const { container } = mountSidebar("/runs/conv-abc");
    expect(navButton(container, "Runs").getAttribute("data-active")).toBe(
      "true",
    );
    expect(navButton(container, "Pipelines").getAttribute("data-active")).not.toBe(
      "true",
    );
  });

  it("marks Runs selected on /runs", () => {
    const { container } = mountSidebar("/runs");
    expect(navButton(container, "Runs").getAttribute("data-active")).toBe(
      "true",
    );
    expect(navButton(container, "Pipelines").getAttribute("data-active")).not.toBe(
      "true",
    );
  });
});

describe("ProjectSidebar settings entry", () => {
  it("renders Settings with href /settings", () => {
    const { container } = mountSidebar("/");
    expect(navLink(container, "Settings").getAttribute("href")).toBe("/settings");
  });

  it("renders Settings at collapsed width", () => {
    const { container } = mountSidebar("/", false);
    expect(navLink(container, "Settings").getAttribute("href")).toBe("/settings");
  });

  it("appears after Cockpit, Agents, Pipelines, and Runs", () => {
    const { container } = mountSidebar("/");
    const labels = Array.from(container.querySelectorAll("a"))
      .map((el) => el.textContent?.trim())
      .filter((label): label is string => Boolean(label));
    const cockpitIndex = labels.indexOf("Cockpit");
    const agentsIndex = labels.indexOf("Agents");
    const pipelinesIndex = labels.indexOf("Pipelines");
    const runsIndex = labels.indexOf("Runs");
    const settingsIndex = labels.indexOf("Settings");
    expect(cockpitIndex).toBeGreaterThanOrEqual(0);
    expect(agentsIndex).toBeGreaterThan(cockpitIndex);
    expect(pipelinesIndex).toBeGreaterThan(agentsIndex);
    expect(runsIndex).toBeGreaterThan(pipelinesIndex);
    expect(settingsIndex).toBeGreaterThan(runsIndex);
  });

  it("marks Settings selected on /settings", () => {
    const { container } = mountSidebar("/settings");
    expect(navButton(container, "Settings").getAttribute("data-active")).toBe(
      "true",
    );
  });
});
