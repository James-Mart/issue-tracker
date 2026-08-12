// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssuePersonasField } from "./issue-personas-field";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("../hooks/use-issue-patch-action", () => ({
  useIssuePatchAction: () => ({
    error: null,
    saving: false,
    run: async (fn: () => Promise<void>) => {
      await fn();
    },
  }),
}));

const t0 = "2026-08-10T12:00:00.000Z";

const project = {
  kind: "project" as const,
  id: "demo",
  title: "Demo",
  mergePolicy: "manual" as const,
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  personas: [{ name: "Planner", description: "Plans work" }],
};

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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLElement) {
  act(() => {
    input.blur();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
});

describe("IssuePersonasField", () => {
  it("renders persisted personas from the issue", () => {
    const { container } = mount(<IssuePersonasField issue={project} />);

    expect(
      (container.querySelector('[aria-label="Persona name"]') as HTMLInputElement)
        .value,
    ).toBe("Planner");
    expect(
      (
        container.querySelector(
          '[aria-label="Persona description"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Plans work");
  });

  it("patches personas after a blur when the draft changed", async () => {
    mutateAsync.mockResolvedValue({});
    const { container } = mount(<IssuePersonasField issue={project} />);
    const description = container.querySelector(
      '[aria-label="Persona description"]',
    ) as HTMLTextAreaElement;

    setInputValue(description, "Plans the work");
    blur(description);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "demo",
      patch: {
        personas: [{ name: "Planner", description: "Plans the work" }],
      },
    });
  });

  it("does not patch when blur leaves personas unchanged", async () => {
    const { container } = mount(<IssuePersonasField issue={project} />);
    const name = container.querySelector(
      '[aria-label="Persona name"]',
    ) as HTMLInputElement;

    blur(name);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("shows a validation error and skips patch for duplicate names", async () => {
    const { container, root } = mount(
      <IssuePersonasField
        issue={{
          ...project,
          personas: [
            { name: "Planner", description: "Plans work" },
            { name: "Implementor", description: "Writes code" },
          ],
        }}
      />,
    );

    const plannerName = container.querySelector(
      '[aria-label="Persona name"]',
    ) as HTMLInputElement;

    setInputValue(plannerName, "Implementor");
    blur(plannerName);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/duplicate persona name/i);

    act(() => {
      root.render(
        <IssuePersonasField
          issue={{
            ...project,
            personas: [
              { name: "Planner", description: "Plans work" },
              { name: "Implementor", description: "Writes code" },
            ],
          }}
        />,
      );
    });

    expect(container.textContent).not.toMatch(/duplicate persona name/i);
    expect(
      (container.querySelector('[aria-label="Persona name"]') as HTMLInputElement)
        .value,
    ).toBe("Planner");
  });

  it("patches when a persona is removed", async () => {
    mutateAsync.mockResolvedValue({});
    const { container } = mount(<IssuePersonasField issue={project} />);

    act(() => {
      (
        container.querySelector(
          'button[title="Remove Planner"]',
        ) as HTMLButtonElement
      ).click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "demo",
      patch: { personas: [] },
    });
  });

  it("resets drafts when issue personas change externally", () => {
    const { container, root } = mount(<IssuePersonasField issue={project} />);

    act(() => {
      root.render(
        <IssuePersonasField
          issue={{
            ...project,
            personas: [{ name: "Implementor", description: "Writes code" }],
          }}
        />,
      );
    });

    expect(
      (container.querySelector('[aria-label="Persona name"]') as HTMLInputElement)
        .value,
    ).toBe("Implementor");
  });
});
