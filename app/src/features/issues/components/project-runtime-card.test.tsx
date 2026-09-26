// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import {
  ProjectRuntimeCard,
  RUNTIME_ENV_VARS,
  RUNTIME_PHASE_FIELDS,
} from "./project-runtime-card";

const mutateAsync = vi.fn();
let secretKeys: string[] = [];

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectSecretKeys: () => ({
    data: { keys: secretKeys },
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
  secretKeys = [];
});

describe("ProjectRuntimeCard", () => {
  it("shows helper text as the placeholder for every empty phase", () => {
    const { container } = mount(<ProjectRuntimeCard issue={project()} />);

    for (const phase of RUNTIME_PHASE_FIELDS) {
      const button = phaseButton(container, phase.label);
      expect(button.textContent).toContain(phase.helper);
      expect(button.className).not.toContain("font-mono");
    }
    for (const variable of RUNTIME_ENV_VARS) {
      expect(container.textContent).toContain(variable.name);
      expect(container.textContent).toContain(variable.detail);
    }
  });

  it("shows a filled phase in mono with its helper as caption", () => {
    const { container } = mount(
      <ProjectRuntimeCard
        issue={project({
          runtime: {
            build: "cmake --build build",
            baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
          },
        })}
      />,
    );

    const build = phaseButton(container, "Build");
    expect(build.textContent).toContain("cmake --build build");
    expect(build.className).toContain("font-mono");
    expect(build.className).toContain("break-all");
    expect(container.textContent).toContain("Compile before start.");

    const seed = phaseButton(container, "Seed");
    expect(seed.textContent).toContain(RUNTIME_PHASE_FIELDS.find((phase) => phase.key === "seed")!.helper);
    expect(container.textContent).toContain("http://127.0.0.1:$AGENT_STACK_PORT");
  });

  it("lists each project secret by key name", () => {
    secretKeys = ["STRIPE_SANDBOX_KEY"];
    const { container } = mount(<ProjectRuntimeCard issue={project()} />);

    expect(container.textContent).toContain("STRIPE_SANDBOX_KEY");
    expect(container.textContent).not.toContain("sk_test");
  });

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

  it("clears one phase and drops runtime when it was the last", async () => {
    mutateAsync.mockResolvedValue({});
    const { container, root } = mount(
      <ProjectRuntimeCard
        issue={project({
          runtime: {
            build: "npm run build",
            start: "npm run dev",
          },
        })}
      />,
    );

    await commitPhase(container, "Build", "   ");

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "platform",
      patch: { runtime: { start: "npm run dev" } },
    });

    mutateAsync.mockClear();
    act(() => {
      root.render(
        <ProjectRuntimeCard
          issue={project({ runtime: { start: "npm run dev" } })}
        />,
      );
    });

    await commitPhase(container, "Start", "");

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "platform",
      patch: { runtime: null },
    });
  });
});
