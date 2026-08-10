// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANUAL_STAKEHOLDER_LABEL } from "@server/fields";
import { StakeholderSelect } from "./stakeholder-select";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="stakeholder-select"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

function mountSelect(
  props: Partial<ComponentProps<typeof StakeholderSelect>> = {},
): { container: HTMLDivElement; root: Root; onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <StakeholderSelect
        value={props.value}
        models={props.models ?? [{ id: "composer-2.5", displayName: "Composer 2.5" }]}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { container, root, onChange };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StakeholderSelect", () => {
  it("renders the unset case as a named manual choice", () => {
    const { container } = mountSelect({ value: undefined });
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;
    const manual = [...select.options].find(
      (option) => option.textContent === MANUAL_STAKEHOLDER_LABEL,
    );
    expect(manual).toBeTruthy();
    expect(select.value).toBe(manual!.value);
  });

  it("clears to null when the manual choice is selected", () => {
    const { container, onChange } = mountSelect({ value: "composer-2.5" });
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;
    const manual = [...select.options].find(
      (option) => option.textContent === MANUAL_STAKEHOLDER_LABEL,
    )!;
    act(() => {
      select.value = manual.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
