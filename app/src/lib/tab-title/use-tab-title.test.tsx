// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useTabTitle } from "./use-tab-title";

function TabTitleProbe({ name }: { name: string }) {
  useTabTitle(name);
  return null;
}

describe("useTabTitle", () => {
  it("sets document.title from the formatter", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    document.title = "Issue Tracker";

    act(() => {
      root.render(<TabTitleProbe name="Cockpit" />);
    });
    expect(document.title).toBe("IT: Cockpit");

    act(() => {
      root.unmount();
    });
    expect(document.title).toBe("Issue Tracker");
    container.remove();
  });
});
