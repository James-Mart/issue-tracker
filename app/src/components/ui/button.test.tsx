// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Button current variant", () => {
  it("renders the translucent current tint from the shared variant", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<Button variant="current">Update from merge base</Button>);
    });

    const button = container.querySelector("button");
    const shared = buttonVariants({ variant: "current" });
    expect(shared).toContain("bg-primary/20");
    expect(shared).toContain("[color:hsl(var(--current))]");
    expect(button?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(shared.split(/\s+/)),
    );
  });
});
