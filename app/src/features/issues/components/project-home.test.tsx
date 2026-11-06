// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
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

function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search">{params.toString()}</div>;
}

function mount(entry: string, issue = project()): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <ProjectHome issue={issue} projectId="platform" catalog={[]} />
        <SearchProbe />
      </MemoryRouter>,
    );
  });
  return container;
}

function currentPeer(container: ParentNode): string | undefined {
  return (
    container.querySelector("nav a[aria-current='page']")?.textContent ??
    undefined
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProjectHome", () => {
  it("leaves a supporting-doc key in place and shows that doc", () => {
    const legacy = mount(
      "/projects/platform/issues/platform?tab=vision",
      project({
        vision: { type: "attachment", name: "vision.md" },
      }),
    );
    expect(legacy.querySelector("[data-testid='search']")?.textContent).toBe(
      "tab=vision",
    );
    expect(
      legacy.querySelector("[data-testid='doc-preview']")?.textContent,
    ).toBe("vision");
    expect(currentPeer(legacy)).toBe("Supporting docs");
  });
});
