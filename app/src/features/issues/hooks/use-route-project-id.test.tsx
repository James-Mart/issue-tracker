// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useRouteProjectId } from "./use-route-project-id";

let root: Root | undefined;

function Probe() {
  const projectId = useRouteProjectId();
  return <div data-testid="project">{projectId ?? ""}</div>;
}

function mount(entry: string): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
      </MemoryRouter>,
    );
  });
  return container;
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

describe("useRouteProjectId", () => {
  it("reads the project from review routes as well as the project page", () => {
    expect(mount("/projects/issue-tracker").textContent).toBe("issue-tracker");
    act(() => root?.unmount());
    expect(mount("/projects/issue-tracker/review").textContent).toBe("issue-tracker");
    act(() => root?.unmount());
    expect(
      mount("/projects/issue-tracker/review/stories/review-home").textContent,
    ).toBe("issue-tracker");
    act(() => root?.unmount());
    expect(mount("/projects/issue-tracker/issues/review-home").textContent).toBe(
      "issue-tracker",
    );
  });
});
