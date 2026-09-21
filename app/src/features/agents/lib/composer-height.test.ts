import { describe, expect, it } from "vitest";
import {
  COMPOSER_MIN_HEIGHT_PX,
  autoGrowCeilingPx,
  clampAutoGrowHeight,
  clampDragHeight,
  dragMaxPx,
} from "./composer-height";

describe("composer auto-grow height", () => {
  it("tracks content between the collapsed minimum and 40% of the pane", () => {
    expect(autoGrowCeilingPx(500)).toBe(200);
    expect(clampAutoGrowHeight(80, 500)).toBe(80);
    expect(clampAutoGrowHeight(20, 500)).toBe(COMPOSER_MIN_HEIGHT_PX);
    expect(clampAutoGrowHeight(280, 500)).toBe(200);
  });

  it("keeps the collapsed minimum when the pane ceiling is smaller", () => {
    expect(clampAutoGrowHeight(80, 80)).toBe(COMPOSER_MIN_HEIGHT_PX);
  });
});

describe("composer drag height", () => {
  it("clamps between the collapsed minimum and 80% of the pane", () => {
    expect(dragMaxPx(500)).toBe(400);
    expect(clampDragHeight(80, 500)).toBe(80);
    expect(clampDragHeight(20, 500)).toBe(COMPOSER_MIN_HEIGHT_PX);
    expect(clampDragHeight(480, 500)).toBe(400);
  });

  it("keeps the collapsed minimum when the drag max is smaller", () => {
    expect(clampDragHeight(80, 40)).toBe(COMPOSER_MIN_HEIGHT_PX);
  });
});
