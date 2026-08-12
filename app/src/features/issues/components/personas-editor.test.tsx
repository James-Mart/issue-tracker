// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonaDraft } from "../lib/personas";
import { PersonasEditor } from "./personas-editor";

const planner: PersonaDraft = {
  key: "Planner",
  name: "Planner",
  description: "Plans work",
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

function PersonasEditorHarness({
  onCommit,
}: {
  onCommit?: (drafts: PersonaDraft[]) => void;
}) {
  const [drafts, setDrafts] = useState<PersonaDraft[]>([planner]);
  return (
    <PersonasEditor
      drafts={drafts}
      onChange={setDrafts}
      onCommit={onCommit}
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PersonasEditor", () => {
  it("shows an empty state when there are no drafts", () => {
    const { container } = mount(
      <PersonasEditor drafts={[]} onChange={vi.fn()} />,
    );

    expect(container.textContent).toContain("No personas.");
    expect(container.querySelector('[aria-label="Persona name"]')).toBeNull();
  });

  it("adds a blank draft row when Add persona is clicked", () => {
    const onChange = vi.fn();
    const { container } = mount(
      <PersonasEditor drafts={[]} onChange={onChange} />,
    );

    act(() => {
      (
        [...container.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("Add persona"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      name: "",
      description: "",
    });
    expect(onChange.mock.calls[0][0][0].key.startsWith("new-")).toBe(true);
  });

  it("calls onChange while editing and onCommit on blur", () => {
    const onCommit = vi.fn();
    const { container } = mount(<PersonasEditorHarness onCommit={onCommit} />);

    const nameInput = container.querySelector(
      '[aria-label="Persona name"]',
    ) as HTMLInputElement;

    setInputValue(nameInput, "Architect");
    blur(nameInput);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0]).toEqual([
      { ...planner, name: "Architect" },
    ]);
  });

  it("commits immediately when a persona is removed", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = mount(
      <PersonasEditor
        drafts={[planner]}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );

    act(() => {
      (
        container.querySelector(
          'button[title="Remove Planner"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onCommit).toHaveBeenCalledWith([]);
  });

  it("shows validation errors and disables controls while saving", () => {
    const { container } = mount(
      <PersonasEditor
        drafts={[planner]}
        onChange={vi.fn()}
        error="duplicate persona name"
        disabled
      />,
    );

    expect(container.textContent).toContain("duplicate persona name");
    expect(container.textContent).toContain("Fix the fields, then save again.");
    expect(
      (container.querySelector('[aria-label="Persona name"]') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Add persona"),
      )?.disabled,
    ).toBe(true);
  });
});
