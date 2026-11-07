// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { SUPPORTING_DOC_KEY_LABELS } from "../lib/supporting-docs";
import { currentHomePeer, homeNav } from "./project-home-bar.test-helpers";
import { ProjectHome } from "./project-home";

vi.mock("./project-structure-lens", () => ({
  ProjectStructureSection: () => (
    <>
      <div data-testid="structure-filters" />
      <div data-testid="structure-lens" />
    </>
  ),
}));

vi.mock("./project-settings-overview", () => ({
  ProjectSettingsOverview: () => <div data-testid="settings" />,
}));

vi.mock("./project-outlines-tab", () => ({
  ProjectOutlinesTab: () => <div data-testid="outlines" />,
}));

vi.mock("./supporting-doc-preview", () => ({
  SupportingDocPreview: ({ tab }: { tab: { key: string } }) => (
    <div data-testid="doc-preview">{tab.key}</div>
  ),
}));

const t0 = "2026-08-01T00:00:00.000Z";

const docs: Extract<IssueDetail, { kind: "project" }>["supportingDocs"] = {
  vision: { type: "attachment", name: "vision.md" },
  codingStandards: { type: "attachment", name: "standards.md" },
  designSystem: { type: "workspace", path: "design.html" },
};

function project(
  supportingDocs?: Extract<IssueDetail, { kind: "project" }>["supportingDocs"],
): Extract<IssueDetail, { kind: "project" }> {
  return {
    id: "platform",
    kind: "project",
    title: "Platform",
    workspace: "/tmp/repo",
    trunk: "main",
    mergePolicy: "pull-request",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
    ...(supportingDocs ? { supportingDocs } : {}),
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="search">{location.search}</div>
      <div data-testid="hash">{location.hash}</div>
    </>
  );
}

const mounts: { root: Root; container: HTMLDivElement }[] = [];

function mount(entry: string, issue = project()): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <ProjectHome issue={issue} projectId="platform" catalog={[]} />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  mounts.push({ root, container });
  return container;
}

function text(container: ParentNode, testId: string): string | undefined {
  return container.querySelector(`[data-testid='${testId}']`)?.textContent ?? undefined;
}

afterEach(() => {
  for (const { root } of mounts) {
    act(() => root.unmount());
  }
  mounts.length = 0;
  document.body.innerHTML = "";
});

describe("ProjectHome supporting docs", () => {
  it("redirects a doc tab onto Supporting docs and keeps the rest of the address", () => {
    const view = mount(
      "/projects/platform/issues/platform?tab=vision&stay=1#section",
      project(docs),
    );
    expect(text(view, "search")).toBe("?tab=supportingDocs&stay=1&doc=vision");
    expect(text(view, "hash")).toBe("#section");
    expect(text(view, "doc-preview")).toBe("vision");
    expect(currentHomePeer(view)).toBe("Supporting docs");
    expect(homeNav(view).textContent).toBe(
      "StructureOverviewOutlinesSupporting docsCode review",
    );
  });

  it("drops a doc that is not previewable and shows the first doc", () => {
    const view = mount(
      "/projects/platform/issues/platform?tab=supportingDocs&doc=gateRubric&stay=1#section",
      project(docs),
    );
    expect(text(view, "search")).toBe("?tab=supportingDocs&stay=1");
    expect(text(view, "hash")).toBe("#section");
    expect(text(view, "doc-preview")).toBe("vision");
    expect(currentHomePeer(view)).toBe("Supporting docs");
  });

  it("sets doc when a document is chosen and keeps the hash", () => {
    const view = mount(
      "/projects/platform/issues/platform?tab=supportingDocs&stay=1#section",
      project(docs),
    );
    const link = Array.from(
      view.querySelectorAll("nav[aria-label='Supporting documents'] a"),
    ).find(
      (anchor) =>
        anchor.textContent === SUPPORTING_DOC_KEY_LABELS.codingStandards,
    );
    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(text(view, "search")).toBe(
      "?tab=supportingDocs&stay=1&doc=codingStandards",
    );
    expect(text(view, "hash")).toBe("#section");
    expect(text(view, "doc-preview")).toBe("codingStandards");
  });
});
