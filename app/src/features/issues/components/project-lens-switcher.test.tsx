// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { projectReviewPath } from "@/features/reviews/lib/links";
import { ProjectLensSwitcher } from "./project-lens-switcher";

let root: Root | undefined;

function mount(active: "structure" | "overview" | "review"): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <ProjectLensSwitcher projectId="proj" active={active} />
      </MemoryRouter>,
    );
  });
  return container;
}

function link(container: HTMLElement, label: string): HTMLAnchorElement {
  const anchor = [...container.querySelectorAll("a")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!anchor) throw new Error(`missing ${label}`);
  return anchor;
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ProjectLensSwitcher", () => {
  it("places Code review after Structure and Overview and links it to the review route", () => {
    const container = mount("structure");
    const labels = [...container.querySelectorAll("a")].map((anchor) => anchor.textContent);
    expect(labels).toEqual(["Structure", "Overview", "Code review"]);
    expect(link(container, "Structure").getAttribute("aria-current")).toBe("page");
    expect(link(container, "Code review").getAttribute("href")).toBe(
      projectReviewPath("proj"),
    );
    expect(link(container, "Overview").getAttribute("href")).toBe(
      "/projects/proj?lens=overview",
    );
  });

  it("marks Code review current and links the other lenses back to the project page", () => {
    const container = mount("review");
    expect(link(container, "Code review").getAttribute("aria-current")).toBe("page");
    expect(link(container, "Structure").getAttribute("href")).toBe("/projects/proj");
    expect(link(container, "Structure").hasAttribute("aria-current")).toBe(false);
  });
});
