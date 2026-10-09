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
  it("is false for a non-sentinel failure", () => {
    expect(shouldRespawn({ code: 1, signal: null })).toBe(false);
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
});
