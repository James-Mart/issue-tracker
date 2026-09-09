// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppendPlanningCallout } from "./append-planning-callout";

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AppendPlanningCallout", () => {
  it("names the target Story in the append planning copy", () => {
    const { container } = mount(
      <AppendPlanningCallout storyTitle="OAuth callback hardening" />,
    );

    expect(
      container.querySelector('[data-testid="append-planning-callout"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Append planning");
    expect(
      container.querySelector('[data-testid="append-planning-callout-copy"]')
        ?.textContent,
    ).toBe(
      "Planning this Idea will append resulting Tasks to OAuth callback hardening instead of creating a new root Story.",
    );
    expect(
      container.querySelector(
        '[data-testid="append-planning-callout-copy"] strong',
      )?.textContent,
    ).toBe("OAuth callback hardening");
  });
});
