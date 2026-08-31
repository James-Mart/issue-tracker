// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail } from "@server/schemas";
import { IssueDetailStatusChips } from "./issue-detail-status-chips";

const t0 = "2026-08-01T00:00:00.000Z";

const idea: IssueDetail = {
  id: "gate",
  kind: "idea",
  title: "Gate",
  partOf: "issue-tracker",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  archived: false,
  description: "",
  labels: [],
};

function mockDerived(ideaStatus: DerivedState["ideaStatus"]) {
  vi.doMock("../api/queries", () => ({
    useIssuesQuery: () => ({
      data: {
        issues: [],
        derived: {
          gate: { blocked: false, ideaStatus },
        },
      },
    }),
  }));
}

async function mountChips(ideaStatus: DerivedState["ideaStatus"]) {
  vi.resetModules();
  mockDerived(ideaStatus);
  const { IssueDetailStatusChips: Chips } = await import(
    "./issue-detail-status-chips"
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Chips issue={idea} />);
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
  vi.doUnmock("../api/queries");
});

describe("IssueDetailStatusChips idea header", () => {
  it("renders the amber awaiting approval chip", async () => {
    const container = await mountChips("awaiting-approval");
    const badge = container.querySelector(".bg-warning\\/15");
    expect(container.textContent).toContain("awaiting approval");
    expect(container.textContent).not.toContain("planning");
    expect(badge).toBeTruthy();
  });

  it("renders the cyan planning chip for planning Ideas", async () => {
    const container = await mountChips("planning");
    const badge = container.querySelector(".bg-primary\\/20");
    expect(container.textContent).toContain("planning");
    expect(container.textContent).not.toContain("awaiting approval");
    expect(badge).toBeTruthy();
  });

  it("renders the cyan planning chip for awaiting-direction Ideas", async () => {
    const container = await mountChips("awaiting-direction");
    const badge = container.querySelector(".bg-primary\\/20");
    expect(container.textContent).toContain("planning");
    expect(container.textContent).not.toContain("awaiting approval");
    expect(badge).toBeTruthy();
  });
});
