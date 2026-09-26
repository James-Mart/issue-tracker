#!/usr/bin/env -S npx tsx
// `npm run typecheck` entry. Acquires worker slots, then runs `tsc` under a
// measured heap limit with fatal-error diagnostic reports.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireAllWorkerSlots, computeWorkerSlotBudget } from "./worker-slot-pool.js";

const GIB = 1024 ** 3;
const SLOT_HEAP_MB = 2048;
const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

// Peak RSS (Maximum resident set size) median of 3 `/usr/bin/time -v` runs
// of `tsc --noEmit -p .` from app/: 1166908 kB.
const TYPECHECK_PEAK_RSS_BYTES = 1_166_908 * 1024;
export const TYPECHECK_SLOTS = Math.max(
  1,
  Math.ceil((TYPECHECK_PEAK_RSS_BYTES * 1.25) / (2 * GIB)),
);

interface HeapReport {
  header?: {
    event?: string;
    processId?: number;
  };
}

export function typecheckSlotsNeverGrantable(slots: number, budget: number): boolean {
  return slots > budget || (slots > 1 && slots >= budget);
}

export function typecheckHeapLimitMb(slots: number = TYPECHECK_SLOTS): number {
  return slots * SLOT_HEAP_MB;
}

export function typecheckMemoryLimitMessage(slots: number = TYPECHECK_SLOTS): string {
  return `typecheck memory limit: tsc exceeded the ${typecheckHeapLimitMb(slots)} MB heap limit`;
}

export function isHeapLimitReport(report: HeapReport): boolean {
  return report.header?.event === HEAP_OOM_EVENT;
}

export function hasHeapLimitReportForPid(reportDir: string, pid: number): boolean {
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("report.") || !name.endsWith(".json")) {
      continue;
    }
    if (!name.includes(`.${pid}.`)) {
      continue;
    }
    try {
      const report = JSON.parse(readFileSync(join(reportDir, name), "utf8")) as HeapReport;
      if (isHeapLimitReport(report)) {
        return true;
      }
    } catch {
      // skip malformed report
    }
  }
  return false;
}

export function assertTypecheckGrantable(slots: number, budget: number): void {
  if (typecheckSlotsNeverGrantable(slots, budget)) {
    throw new Error(
      `typecheck needs ${slots} worker slot(s) but the pool budget is ${budget}; ` +
        "that grant can never be satisfied",
    );
  }
}

export function resolveTypecheckExitCode(
  code: number | null,
  pid: number | undefined,
  reportDir: string,
): number {
  if (code !== 0 && pid !== undefined && hasHeapLimitReportForPid(reportDir, pid)) {
    console.error(typecheckMemoryLimitMessage());
    return 1;
  }
  if (code === null) {
    throw new Error("tsc exited from a signal");
  }
  return code;
}

function raiseOomScoreAdj(): void {
  if (process.platform === "linux") {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  }
}

export async function runTypecheck(cwd: string = join(dirname(fileURLToPath(import.meta.url)), "..")): Promise<number> {
  const budget = computeWorkerSlotBudget();
  assertTypecheckGrantable(TYPECHECK_SLOTS, budget);
  await acquireAllWorkerSlots(TYPECHECK_SLOTS);

  raiseOomScoreAdj();

  const tsc = join(cwd, "node_modules", "typescript", "bin", "tsc");
  const reportDir = mkdtempSync(join(tmpdir(), "typecheck-heap-"));
  const heapMb = typecheckHeapLimitMb();

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${heapMb}`,
        "--report-on-fatalerror",
        `--report-directory=${reportDir}`,
        tsc,
        "--noEmit",
        "-p",
        ".",
      ],
      { cwd, stdio: "inherit" },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      try {
        resolvePromise(resolveTypecheckExitCode(code, child.pid, reportDir));
      } catch (err) {
        reject(err);
      } finally {
        rmSync(reportDir, { recursive: true, force: true });
      }
    });
  });
}

async function main(): Promise<void> {
  const code = await runTypecheck();
  process.exit(code);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
