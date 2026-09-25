import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { File, Reporter } from "vitest/node";

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";
const HEAP_LIMIT_MB = 2048;

interface HeapReport {
  header?: {
    event?: string;
    processId?: number;
  };
}

interface WorkerMapping {
  pid: number;
  file: string;
}

function readWorkerFile(reportDir: string, pid: number): string | undefined {
  try {
    const mapping = JSON.parse(
      readFileSync(join(reportDir, `worker-${pid}.json`), "utf8"),
    ) as WorkerMapping;
    return mapping.file;
  } catch {
    return undefined;
  }
}

export default class MemoryLimitReporter implements Reporter {
  onFinished(_files: File[], _errors: unknown[]): void {
    const reportDir = process.env.VITEST_HEAP_REPORT_DIR;
    if (!reportDir) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(reportDir);
    } catch {
      return;
    }

    const reportedFiles = new Set<string>();
    for (const name of entries) {
      if (!name.startsWith("report.") || !name.endsWith(".json")) {
        continue;
      }

      let report: HeapReport;
      try {
        report = JSON.parse(readFileSync(join(reportDir, name), "utf8"));
      } catch {
        continue;
      }

      if (report.header?.event !== HEAP_OOM_EVENT) {
        continue;
      }

      const pid = report.header.processId;
      if (pid === undefined) {
        continue;
      }

      const file = readWorkerFile(reportDir, pid);
      if (!file || reportedFiles.has(file)) {
        continue;
      }

      reportedFiles.add(file);
      console.error(
        `vitest memory limit: ${file} exceeded the ${HEAP_LIMIT_MB} MB per-worker heap limit`,
      );
    }

    if (reportedFiles.size > 0) {
      process.exitCode = 1;
    }

    rmSync(reportDir, { recursive: true, force: true });
  }
}
