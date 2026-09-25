import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TYPECHECK_SLOTS,
  assertTypecheckGrantable,
  hasHeapLimitReportForPid,
  isHeapLimitReport,
  resolveTypecheckExitCode,
  typecheckHeapLimitMb,
  typecheckMemoryLimitMessage,
  typecheckSlotsNeverGrantable,
} from "./run-typecheck.js";

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

describe("TYPECHECK_SLOTS", () => {
  it("derives one slot from the measured peak RSS", () => {
    expect(TYPECHECK_SLOTS).toBe(1);
    expect(typecheckHeapLimitMb()).toBe(2048);
  });
});

describe("typecheckSlotsNeverGrantable", () => {
  it("rejects when slots exceed the budget", () => {
    expect(typecheckSlotsNeverGrantable(4, 3)).toBe(true);
  });

  it("rejects a multi-slot request that needs the last free slot", () => {
    expect(typecheckSlotsNeverGrantable(2, 2)).toBe(true);
  });

  it("allows a one-slot request against a one-slot budget", () => {
    expect(typecheckSlotsNeverGrantable(1, 1)).toBe(false);
  });
});

describe("assertTypecheckGrantable", () => {
  it("throws when the grant can never be satisfied", () => {
    expect(() => assertTypecheckGrantable(2, 2)).toThrow(
      "typecheck needs 2 worker slot(s) but the pool budget is 2; that grant can never be satisfied",
    );
  });
});

describe("heap limit reporting", () => {
  let reportDir: string;

  beforeEach(() => {
    reportDir = mkdtempSync(join(tmpdir(), "typecheck-report-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects a heap-limit diagnostic report for a pid", () => {
    const pid = 42_001;
    writeFileSync(
      join(reportDir, `report.${pid}.42.42.42.42.json`),
      JSON.stringify({ header: { event: HEAP_OOM_EVENT, processId: pid } }),
    );
    expect(isHeapLimitReport({ header: { event: HEAP_OOM_EVENT } })).toBe(true);
    expect(hasHeapLimitReportForPid(reportDir, pid)).toBe(true);
    expect(hasHeapLimitReportForPid(reportDir, pid + 1)).toBe(false);
  });

  it("prints the typecheck memory-limit line and exits non-zero", () => {
    const pid = 42_002;
    writeFileSync(
      join(reportDir, `report.${pid}.42.42.42.42.json`),
      JSON.stringify({ header: { event: HEAP_OOM_EVENT, processId: pid } }),
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(resolveTypecheckExitCode(134, pid, reportDir)).toBe(1);
    expect(stderr).toHaveBeenCalledWith(typecheckMemoryLimitMessage());
  });
});
