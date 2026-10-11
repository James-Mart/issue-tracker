// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { ProjectRuntimeCard } from "./project-runtime-card";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectSecretKeys: () => ({
    data: { keys: [] },
    isError: false,
  }),
}));

const t0 = "2026-08-01T00:00:00.000Z";

function project(
  overrides: Partial<Extract<IssueDetail, { kind: "project" }>> = {},
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
    ...overrides,
  };
}

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

function phaseButton(container: HTMLElement, label: string): HTMLButtonElement {
  const labelNode = [...container.querySelectorAll("span")].find(
    (node) => node.textContent === label,
  );
  const button = labelNode?.parentElement?.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing phase button for ${label}`);
  }
  return button;
}

async function commitPhase(
  container: HTMLElement,
  label: string,
  value: string,
): Promise<void> {
  await act(async () => {
    phaseButton(container, label).click();
  });
  const input = container.querySelector("textarea");
  if (!(input instanceof HTMLTextAreaElement)) {
    throw new Error(`missing input for ${label}`);
  }
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
});

describe("ProjectRuntimeCard", () => {
  it("saves one phase through the project update and keeps the others", async () => {
    mutateAsync.mockResolvedValue({});
    const { container } = mount(
      <ProjectRuntimeCard
        issue={project({
          runtime: { start: "npm run dev" },
        })}
      />,
    );

    await commitPhase(container, "Build", "  npm run build\nnpm test\n");

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "platform",
      patch: {
        runtime: {
          start: "npm run dev",
          build: "npm run build\nnpm test",
        },
      },
    });
  });
});
