// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  CHANGED_SINCE_REVIEWED_LABEL,
  ChangedSinceReviewedBadge,
} from "./changed-since-reviewed-badge";

let root: Root | undefined;

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

describe("ChangedSinceReviewedBadge", () => {
  it("is icon-only with a single accessible name matching the tooltip", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <TooltipProvider delayDuration={0}>
          <ChangedSinceReviewedBadge />
        </TooltipProvider>,
      );
    });

    const badge = container.querySelector('[data-testid="review-changed-since-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent?.replace(/\s/g, "")).toBe("");
    expect(badge!.getAttribute("title")).toBeNull();
    expect(badge!.getAttribute("aria-label")).toBe(CHANGED_SINCE_REVIEWED_LABEL);
  });
});
