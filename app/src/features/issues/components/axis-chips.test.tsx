// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StoryAxisChips } from "./axis-chips";

function mount(node: ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function chipTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("div")].map(
    (el) => el.textContent ?? "",
  );
}

describe("StoryAxisChips tracker review prefix", () => {
  let mounted: { container: HTMLDivElement; root: Root } | undefined;

  afterEach(() => {
    if (!mounted) return;
    act(() => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = undefined;
  });

  it("reads gate for the review status and stale, and leaves the story status chip unprefixed", () => {
    mounted = mount(
      <StoryAxisChips
        storyStatus="in-progress"
        review="passed"
        reviewStale
      />,
    );

    expect(chipTexts(mounted.container)).toEqual([
      "in progress",
      "gate: passed",
      "gate: stale",
    ]);
  });
});
