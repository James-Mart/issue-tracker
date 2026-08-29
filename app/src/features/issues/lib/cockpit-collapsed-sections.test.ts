// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY,
  readCockpitCollapsedSectionKeys,
  toggleCockpitCollapsedSectionKey,
  writeCockpitCollapsedSectionKeys,
} from "./cockpit-collapsed-sections";

describe("readCockpitCollapsedSectionKeys", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to an empty set when storage is unset", () => {
    expect(readCockpitCollapsedSectionKeys()).toEqual(new Set());
  });

  it("round-trips collapsed section keys", () => {
    writeCockpitCollapsedSectionKeys(["inFlight", "ready"]);
    expect(readCockpitCollapsedSectionKeys()).toEqual(
      new Set(["inFlight", "ready"]),
    );
  });

  it("returns an empty set for malformed JSON", () => {
    localStorage.setItem(COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY, "{");
    expect(readCockpitCollapsedSectionKeys()).toEqual(new Set());
  });

  it("returns an empty set when JSON is not an array", () => {
    localStorage.setItem(
      COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify({ inFlight: true }),
    );
    expect(readCockpitCollapsedSectionKeys()).toEqual(new Set());
  });

  it("drops unknown keys without inventing replacements", () => {
    localStorage.setItem(
      COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(["inFlight", "blocked", "ready", 42, null]),
    );
    expect(readCockpitCollapsedSectionKeys()).toEqual(
      new Set(["inFlight", "ready"]),
    );
  });
});

describe("toggleCockpitCollapsedSectionKey", () => {
  it("adds and removes keys without mutating the input", () => {
    const collapsed = new Set(["inFlight"] as const);
    expect(toggleCockpitCollapsedSectionKey(collapsed, "ready")).toEqual(
      new Set(["inFlight", "ready"]),
    );
    expect(collapsed).toEqual(new Set(["inFlight"]));

    expect(toggleCockpitCollapsedSectionKey(collapsed, "inFlight")).toEqual(
      new Set(),
    );
  });
});
