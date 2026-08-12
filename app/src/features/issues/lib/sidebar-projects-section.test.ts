// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  readSidebarProjectsSectionOpen,
  writeSidebarProjectsSectionOpen,
} from "./sidebar-projects-section";

describe("sidebar projects section cookie", () => {
  afterEach(() => {
    document.cookie =
      "sidebar_projects_section_open=; path=/; max-age=0";
  });

  it("defaults to open when the cookie is unset", () => {
    expect(readSidebarProjectsSectionOpen()).toBe(true);
  });

  it("reads true and false from the cookie", () => {
    writeSidebarProjectsSectionOpen(false);
    expect(readSidebarProjectsSectionOpen()).toBe(false);

    writeSidebarProjectsSectionOpen(true);
    expect(readSidebarProjectsSectionOpen()).toBe(true);
  });

  it("throws on malformed cookie values", () => {
    document.cookie = "sidebar_projects_section_open=maybe; path=/";
    expect(() => readSidebarProjectsSectionOpen()).toThrow(/Invalid/);
  });
});
