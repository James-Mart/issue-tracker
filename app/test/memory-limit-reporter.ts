import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { File, Reporter } from "vitest/node";

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";
const HEAP_LIMIT_MB = 2048;
const REPORT_WAIT_MS = 500;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isWorkerExitError(error: unknown): boolean {
  return error instanceof Error && error.message === "Worker exited unexpectedly";
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

function listWorkerMappings(reportDir: string): WorkerMapping[] {
  const mappings: WorkerMapping[] = [];
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("worker-") || !name.endsWith(".json")) {
      continue;
    }
    try {
      mappings.push(
        JSON.parse(readFileSync(join(reportDir, name), "utf8")) as WorkerMapping,
      );
    } catch {
      // skip malformed mapping
    }
  }
  return mappings;
}

function hasHeapReportForPid(reportDir: string, pid: number): boolean {
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("report.") || !name.endsWith(".json")) {
      continue;
    }
    if (!name.includes(`.${pid}.`)) {
      continue;
    }
    try {
      const report = JSON.parse(
        readFileSync(join(reportDir, name), "utf8"),
      ) as HeapReport;
      if (report.header?.event === HEAP_OOM_EVENT) {
        return true;
      }
    } catch {
      // skip malformed report
    }
  }
  return false;
}

function testFileDidNotComplete(
  files: File[],
  relativeFile: string,
  root: string,
): boolean {
  const match = files.find((file) => {
    const normalized = relative(root, file.filepath).replace(/\\/g, "/");
    return normalized === relativeFile || file.filepath.endsWith(relativeFile);
  });
  if (!match) {
    return true;
  }
  return match.result?.state !== "pass";
}

async function waitForHeapReports(reportDir: string): Promise<void> {
  const deadline = Date.now() + REPORT_WAIT_MS;
  while (Date.now() < deadline) {
    const hasReport = readdirSync(reportDir).some(
      (name) => name.startsWith("report.") && name.endsWith(".json"),
    );
    if (hasReport) {
      return;
    }
    await delay(25);
  }
}

function printMemoryLimitLine(file: string): void {
  console.error(
    `vitest memory limit: ${file} exceeded the ${HEAP_LIMIT_MB} MB per-worker heap limit`,
  );
}

function collectFromHeapReports(
  reportDir: string,
  reportedFiles: Set<string>,
): void {
  for (const name of readdirSync(reportDir)) {
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
    printMemoryLimitLine(file);
  }
}

function collectFromWorkerMappings(
  reportDir: string,
  files: File[],
  errors: unknown[],
  reportedFiles: Set<string>,
): void {
  if (!errors.some(isWorkerExitError)) {
    return;
  }

  const root = resolve(process.cwd());
  for (const mapping of listWorkerMappings(reportDir)) {
    if (reportedFiles.has(mapping.file)) {
      continue;
    }
    if (hasHeapReportForPid(reportDir, mapping.pid)) {
      continue;
    }
    if (!testFileDidNotComplete(files, mapping.file, root)) {
      continue;
    }

    reportedFiles.add(mapping.file);
    printMemoryLimitLine(mapping.file);
  }
}

export default class MemoryLimitReporter implements Reporter {
  async onFinished(files: File[], errors: unknown[]): Promise<void> {
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

    if (entries.some((name) => name.startsWith("report.") && name.endsWith(".json"))) {
      // Reports may still be flushing when the worker dies.
    } else {
      await waitForHeapReports(reportDir);
    }

    const reportedFiles = new Set<string>();
    collectFromHeapReports(reportDir, reportedFiles);
    collectFromWorkerMappings(reportDir, files, errors, reportedFiles);

    rmSync(reportDir, { recursive: true, force: true });

    if (reportedFiles.size > 0) {
      process.exitCode = 1;
      process.exit(1);
    }
  }
}
