import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AGENT_STACK_HEAP_MB = 2048;
const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

interface HeapReport {
  header?: {
    event?: string;
    commandLine?: string[];
  };
}

export function agentStackMemoryLimitMessage(commandLine: string[]): string {
  return `agent stack memory limit: ${commandLine.join(" ")} exceeded the ${AGENT_STACK_HEAP_MB} MB heap limit`;
}

export function collectAgentStackMemoryLimitFailures(dataDir: string): string[] {
  const reportDir = join(dataDir, "heap-reports");
  if (!existsSync(reportDir)) return [];
  const failures: string[] = [];
  for (const name of readdirSync(reportDir)) {
    if (!name.startsWith("report.") || !name.endsWith(".json")) {
      continue;
    }
    try {
      const report = JSON.parse(
        readFileSync(join(reportDir, name), "utf8"),
      ) as HeapReport;
      if (report.header?.event !== HEAP_OOM_EVENT) {
        continue;
      }
      const commandLine = report.header.commandLine;
      if (!commandLine || commandLine.length === 0) {
        continue;
      }
      failures.push(agentStackMemoryLimitMessage(commandLine));
    } catch {
      // skip malformed report
    }
  }
  return failures;
}
