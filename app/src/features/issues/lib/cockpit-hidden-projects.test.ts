// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  readCockpitHiddenProjectIds,
  toggleCockpitHiddenProjectId,
  writeCockpitHiddenProjectIds,
} from "./cockpit-hidden-projects";

describe("cockpit hidden project ids cookie", () => {
  afterEach(() => {
    document.cookie = "cockpit_hidden_project_ids=; path=/; max-age=0";
  });

  it("defaults to an empty list when the cookie is unset", () => {
    expect(readCockpitHiddenProjectIds()).toEqual([]);
  });

  it("round-trips a set of project ids", () => {
    writeCockpitHiddenProjectIds(["alpha", "beta/gamma"]);
    expect(readCockpitHiddenProjectIds()).toEqual(["alpha", "beta/gamma"]);
  });

  it("throws on a %-malformed cookie", () => {
    document.cookie = "cockpit_hidden_project_ids=%; path=/";
    expect(() => readCockpitHiddenProjectIds()).toThrow();
  });
});

describe("toggleCockpitHiddenProjectId", () => {
  it("adds and removes ids without mutating the input", () => {
    const hidden = ["a"];
    expect(toggleCockpitHiddenProjectId(hidden, "b")).toEqual(["a", "b"]);
    expect(hidden).toEqual(["a"]);
    expect(toggleCockpitHiddenProjectId(["a", "b"], "a")).toEqual(["b"]);
  });
});
