// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { OutlineNewPlanningSessionControl } from "./outline-new-planning-session";

const { mutate } = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock("../api/mutations", () => ({
  useStartOutlinePlanningSession: () => ({
    mutate,
    isPending: false,
  }),
}));

const outline: Extract<IssueDetail, { kind: "outline" }> = {
  id: "spec",
  kind: "outline",
  title: "Spec",
  partOf: "issue-tracker",
  bodyVersion: 3,
  archived: false,
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  version: "1",
};

function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <OutlineNewPlanningSessionControl
        outline={outline}
        onStarted={() => undefined}
      />,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
});

describe("OutlineNewPlanningSessionControl", () => {
  it("keeps the title outside the scrolling brief and starts with the brief", () => {
    const { container } = mount();
    act(() => {
      (
        container.querySelector(
          '[data-testid="outline-new-planning-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    const dialog = document.body.querySelector(
      '[data-testid="outline-new-planning-session-dialog"]',
    );
    const title = dialog?.querySelector("h2");
    const body = dialog?.querySelector(
      '[data-testid="outline-new-planning-session-body"]',
    );
    expect(title?.textContent).toBe("New planning session");
    expect(body?.contains(title!)).toBe(false);
    expect(dialog?.textContent).toContain("outline v3");

    const brief = document.body.querySelector(
      '[data-testid="outline-new-planning-brief"]',
    ) as HTMLTextAreaElement;
    const start = document.body.querySelector(
      '[data-testid="outline-new-planning-session-start"]',
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(brief, "Split the tabs");
      brief.dispatchEvent(new Event("input", { bubbles: true }));
      brief.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      start.click();
    });

    expect(mutate).toHaveBeenCalledWith(
      { brief: "Split the tabs" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
