import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESTART_SUPERVISED_ENV_VAR,
  shouldRespawn,
} from "./restart-contract.js";

afterEach(() => {
  delete process.env[RESTART_SUPERVISED_ENV_VAR];
  vi.resetModules();
});

describe("shouldRespawn", () => {
  it("is true for the sentinel exit", () => {
    expect(shouldRespawn({ code: 75, signal: null })).toBe(true);
  });

  it("is false for a normal exit", () => {
    expect(shouldRespawn({ code: 0, signal: null })).toBe(false);
  });

  it("is false for a non-sentinel failure", () => {
    expect(shouldRespawn({ code: 1, signal: null })).toBe(false);
  });

  it("is false when terminated by signal", () => {
    expect(shouldRespawn({ code: null, signal: "SIGTERM" })).toBe(false);
  });
});

async function loadContract() {
  vi.resetModules();
  return import("./restart-contract.js");
}

describe("captureRestartSupervision", () => {
  it("drops the env marker after capture(true)", async () => {
    process.env[RESTART_SUPERVISED_ENV_VAR] = "1";
    const { captureRestartSupervision, isRestartSupervised } =
      await loadContract();
    captureRestartSupervision(true);
    expect(process.env[RESTART_SUPERVISED_ENV_VAR]).toBeUndefined();
    expect(isRestartSupervised()).toBe(true);
  });

  it("drops the env marker after capture(false)", async () => {
    process.env[RESTART_SUPERVISED_ENV_VAR] = "1";
    const { captureRestartSupervision, isRestartSupervised } =
      await loadContract();
    captureRestartSupervision(false);
    expect(process.env[RESTART_SUPERVISED_ENV_VAR]).toBeUndefined();
    expect(isRestartSupervised()).toBe(false);
  });
});

describe("isRestartSupervised", () => {
  it("reads the env var when capture has not run", async () => {
    process.env[RESTART_SUPERVISED_ENV_VAR] = "1";
    const { isRestartSupervised } = await loadContract();
    expect(isRestartSupervised()).toBe(true);
  });
});
