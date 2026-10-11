import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveTypecheckExitCode,
  typecheckMemoryLimitMessage,
} from "./run-typecheck.js";

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

describe("heap limit reporting", () => {
  let reportDir: string;

  beforeEach(() => {
    reportDir = mkdtempSync(join(tmpdir(), "typecheck-report-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
