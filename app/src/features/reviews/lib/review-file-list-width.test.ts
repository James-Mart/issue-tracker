// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_FILE_LIST_WIDTH,
  MIN_REVIEW_FILE_LIST_WIDTH,
  REVIEW_FILE_LIST_WIDTH_STORAGE_KEY,
  clampReviewFileListWidth,
  clearStoredReviewFileListWidth,
  maxReviewFileListWidth,
  readStoredReviewFileListWidth,
  resolveReviewFileListWidth,
  writeStoredReviewFileListWidth,
} from "./review-file-list-width";

describe("review-file-list-width", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults when nothing valid is stored", () => {
    expect(readStoredReviewFileListWidth()).toBeNull();
    expect(resolveReviewFileListWidth(null, 0)).toBe(DEFAULT_REVIEW_FILE_LIST_WIDTH);
    localStorage.setItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY, "nope");
    expect(readStoredReviewFileListWidth()).toBeNull();
    localStorage.setItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY, "0");
    expect(readStoredReviewFileListWidth()).toBeNull();
  });

  it("round-trips a width and clears back to the default", () => {
    writeStoredReviewFileListWidth(320);
    expect(readStoredReviewFileListWidth()).toBe(320);
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe("320");
    clearStoredReviewFileListWidth();
    expect(readStoredReviewFileListWidth()).toBeNull();
    expect(resolveReviewFileListWidth(null, 1000)).toBe(DEFAULT_REVIEW_FILE_LIST_WIDTH);
  });

  it("clamps to the floor and to half the split", () => {
    expect(maxReviewFileListWidth(1000)).toBe(500);
    expect(clampReviewFileListWidth(100, 1000)).toBe(MIN_REVIEW_FILE_LIST_WIDTH);
    expect(clampReviewFileListWidth(900, 1000)).toBe(500);
    expect(clampReviewFileListWidth(320.4, 1000)).toBe(320);
    expect(resolveReviewFileListWidth(900, 1000)).toBe(500);
    expect(resolveReviewFileListWidth(40, 1000)).toBe(MIN_REVIEW_FILE_LIST_WIDTH);
  });

  it("keeps the floor when half the split is narrower than it", () => {
    expect(clampReviewFileListWidth(100, 200)).toBe(MIN_REVIEW_FILE_LIST_WIDTH);
    expect(clampReviewFileListWidth(400, 200)).toBe(MIN_REVIEW_FILE_LIST_WIDTH);
  });
});
