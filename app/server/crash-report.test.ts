import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootId } from "./boot-info.js";
import { conversationsDir, logsDir, refreshStorePathsFromEnv } from "./config.js";
import { serializeErrorChain, writeCrashReport } from "./crash-report.js";

let root: string;
let savedIssuesDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crash-report-"));
  savedIssuesDir = process.env.ISSUES_DIR;
  process.env.ISSUES_DIR = join(root, "issues");
  refreshStorePathsFromEnv();
});

afterEach(() => {
  if (savedIssuesDir === undefined) delete process.env.ISSUES_DIR;
  else process.env.ISSUES_DIR = savedIssuesDir;
  refreshStorePathsFromEnv();
  rmSync(root, { recursive: true, force: true });
});

function writeMarker(conversationId: string, markerBootId: string): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "run-live.json"),
    JSON.stringify({ pid: 1, bootId: markerBootId, processStartedAt: 1 }),
  );
}

describe("crash-report", () => {
  it("serializes the cause chain with errno fields", () => {
    const reset = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
      syscall: "read",
      errno: -104,
    });
    const chain = serializeErrorChain(
      Object.assign(new Error("outer", { cause: reset }), { rawMessage: "raw" }),
    );
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ message: "outer", rawMessage: "raw" });
    expect(chain[1]).toMatchObject({
      message: "read ECONNRESET",
      code: "ECONNRESET",
      syscall: "read",
      errno: -104,
    });
  });

  it("serializes a non-Error throw", () => {
    expect(serializeErrorChain("boom")).toEqual([{ message: "boom" }]);
  });

  it("writes a report naming this boot's live conversations", () => {
    writeMarker("mine", bootId);
    writeMarker("other-boot", "someone-else");

    const path = writeCrashReport(new Error("fatal"), "uncaughtException");

    expect(path).not.toBeNull();
    expect(path!.startsWith(logsDir)).toBe(true);
    const report = JSON.parse(readFileSync(path!, "utf8"));
    expect(report).toMatchObject({
      bootId,
      pid: process.pid,
      origin: "uncaughtException",
      liveConversations: ["mine"],
    });
    expect(report.errorChain[0].message).toBe("fatal");
    expect(report.memory.rss).toBeGreaterThan(0);
  });
});
