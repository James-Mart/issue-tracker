import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocateRuntimeResources,
  bootRuntime,
  type RuntimeBootPhaseReport,
} from "./runtime-boot.js";

let root: string;
let worktree: string;
let logDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-runtime-boot-"));
  worktree = join(root, "worktree");
  logDir = join(root, "logs");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(logDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function nodeScript(source: string): string {
  const path = join(root, `script-${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(path, source);
  return `node ${JSON.stringify(path)}`;
}

describe("bootRuntime phase reporting", () => {
  it("keeps readiness startedAt across probe shells", async () => {
    const attemptsFile = join(root, "readiness-attempts");
    writeFileSync(attemptsFile, "0");
    const readiness = nodeScript(`
      const fs = require("fs");
      const path = ${JSON.stringify(attemptsFile)};
      const attempts = Number(fs.readFileSync(path, "utf8")) + 1;
      fs.writeFileSync(path, String(attempts));
      process.exit(attempts >= 3 ? 0 : 1);
    `);
    const start = nodeScript(`
      const net = require("net");
      net.createServer().listen(Number(process.env.AGENT_STACK_PORT), "127.0.0.1");
      setInterval(() => {}, 1e9);
    `);

    const resources = await allocateRuntimeResources(root);
    const reports: RuntimeBootPhaseReport[] = [];
    await bootRuntime({
      logDir,
      resources,
      worktree,
      runtime: {
        start,
        readiness,
        baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
      },
      secrets: {},
      signal: AbortSignal.timeout(60_000),
      onPhase: (report) => reports.push(report),
    });

    const readinessReports = reports.filter((report) => report.phase === "readiness");
    expect(readinessReports.length).toBeGreaterThanOrEqual(2);
    const firstStartedAt = readinessReports[0]!.startedAt;
    for (const report of readinessReports) {
      expect(report.startedAt).toBe(firstStartedAt);
    }
    expect(Number(readFileSync(attemptsFile, "utf8"))).toBeGreaterThanOrEqual(3);
  });
});
