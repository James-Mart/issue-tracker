// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewCollapsibleSearch } from "./overview-collapsible-search";

function mountSearch(
  props: Partial<ComponentProps<typeof OverviewCollapsibleSearch>> = {},
): {
  container: HTMLDivElement;
  root: Root;
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn<(value: string) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <OverviewCollapsibleSearch
        value=""
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { container, root, onChange };
}

function searchControl(container: ParentNode): HTMLElement {
  const control = container.querySelector('[aria-label="Search overview"]');
  expect(control).toBeTruthy();
  return control as HTMLElement;
}

function setInputValue(input: HTMLInputElement, next: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressKey(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

function blurInput(input: HTMLInputElement) {
  act(() => {
    input.blur();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OverviewCollapsibleSearch", () => {
  it("starts as a compact icon button", () => {
    const { container } = mountSearch();
    expect(searchControl(container).tagName).toBe("BUTTON");
    expect(container.querySelector("input")).toBeNull();
  });

  it("expands into an input on icon click", () => {
    const { container } = mountSearch();
    act(() => {
      (searchControl(container) as HTMLButtonElement).click();
    });
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("focuses search when / is pressed outside editable fields", () => {
    const { container } = mountSearch();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true }),
      );
    });
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("does not steal / while typing elsewhere", () => {
    const { container } = mountSearch();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true }),
      );
    });

    expect(container.querySelector("input")).toBeNull();
  });

  it("filters via onChange and collapses on Esc", () => {
    const { container, onChange } = mountSearch();
    act(() => {
      (searchControl(container) as HTMLButtonElement).click();
    });
    const input = container.querySelector("input") as HTMLInputElement;

    setInputValue(input, "epic");
    expect(onChange).toHaveBeenCalledWith("epic");

    pressKey(input, "Escape");
    expect(container.querySelector("input")).toBeNull();
    expect(searchControl(container).tagName).toBe("BUTTON");
  });

  it("collapses on blur when empty", () => {
    const { container } = mountSearch();
    act(() => {
      (searchControl(container) as HTMLButtonElement).click();
    });
    const input = container.querySelector("input") as HTMLInputElement;

    blurInput(input);
    expect(container.querySelector("input")).toBeNull();
  });

  it("stays expanded on blur while a query is active", () => {
    const { container } = mountSearch({ value: "epic" });
    act(() => {
      (searchControl(container) as HTMLButtonElement).click();
    });
    const input = container.querySelector("input") as HTMLInputElement;

    blurInput(input);
    expect(container.querySelector("input")).toBeTruthy();
  });
});
