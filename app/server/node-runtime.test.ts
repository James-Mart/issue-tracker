import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MIN_NODE_VERSION,
  assertSupportedNodeRuntime,
  isSupportedNodeVersion,
} from "./node-runtime.js";

describe("isSupportedNodeVersion", () => {
  it("accepts the minimum and newer patches/majors", () => {
    expect(isSupportedNodeVersion(MIN_NODE_VERSION)).toBe(true);
    expect(isSupportedNodeVersion("22.13.1")).toBe(true);
    expect(isSupportedNodeVersion("22.22.1")).toBe(true);
    expect(isSupportedNodeVersion("24.5.0")).toBe(true);
  });

  it("rejects older majors and the 22.x line below 22.13", () => {
    expect(isSupportedNodeVersion("20.11.0")).toBe(false);
    expect(isSupportedNodeVersion("22.12.0")).toBe(false);
    expect(isSupportedNodeVersion("21.0.0")).toBe(false);
  });

  it("rejects unparseable strings", () => {
    expect(isSupportedNodeVersion("")).toBe(false);
    expect(isSupportedNodeVersion("v22.13.0")).toBe(false);
    expect(isSupportedNodeVersion("22.13")).toBe(false);
  });
});

describe("assertSupportedNodeRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns without exiting on a supported version", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    expect(() => assertSupportedNodeRuntime("22.13.0")).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits 1 on an unsupported version", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertSupportedNodeRuntime("20.11.0")).toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining("Node >= 22.13.0"),
    );
  });
});
