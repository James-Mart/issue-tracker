import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SERVICES_DIR = dirname(fileURLToPath(import.meta.url));
const HOLDER = join(SERVICES_DIR, "issues-store-lock.test-holder.ts");

let dir: string;

function seedProject(id: string): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(
    join(dir, id, "issue.json"),
    `${JSON.stringify(
      {
        id,
        kind: "project",
        title: "P",
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
      null,
      2,
    )}\n`,
  );
}

function seedIssue(
  id: string,
  body: Record<string, unknown>,
  description = "",
): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(
    join(dir, id, "issue.json"),
    `${JSON.stringify({ id, ...body }, null, 2)}\n`,
  );
  if (description) {
    writeFileSync(join(dir, id, "description.md"), description);
  }
}

function spawnHolder(
  args: string[],
): Promise<{ stdout: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", HOLDER, dir, ...args],
      { env: { ...process.env, ISSUES_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ stdout: stdout.trim(), status }));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-store-lock-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("withIssuesStoreLock", () => {
  it("gives distinct sibling orders to two overlapping creates in separate processes", async () => {
    seedProject("p");
    const [first, second] = await Promise.all([
      spawnHolder(["create-idea", "p", "First"]),
      spawnHolder(["create-idea", "p", "Second"]),
    ]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const orders = [first.stdout, second.stdout].map((line) => JSON.parse(line).order);
    expect(new Set(orders).size).toBe(2);
  });

  it("removes a lock whose pid is dead and lets the writer proceed", async () => {
    seedProject("p");
    const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    expect(exited.status).toBe(0);
    writeFileSync(
      join(dir, ".store.lock"),
      `${JSON.stringify({ pid: exited.pid })}\n`,
    );
    const { create } = await import("./issues.js");
    const created = await create({ kind: "idea", title: "After stale lock", partOf: "p" });
    expect(created.order).toBe(0);
    expect(existsSync(join(dir, ".store.lock"))).toBe(false);
  });

  it("returns a read whose version matches title and description during a staggered publish", async () => {
    seedProject("p");
    seedIssue(
      "leaf",
      {
        kind: "idea",
        title: "Old title",
        partOf: "p",
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
      "Old body\n",
    );
    const signalPath = join(dir, "json-ready");
    const continuePath = join(dir, "continue");
    const publisherDone = spawnHolder([
      "partial-publish",
      "leaf",
      signalPath,
      continuePath,
      "New title",
      "New body\n",
    ]);
    for (let i = 0; i < 500 && !existsSync(signalPath); i++) {
      await delay(10);
    }
    expect(existsSync(signalPath)).toBe(true);
    const readerDone = spawnHolder(["read-detail", "leaf"]);
    writeFileSync(continuePath, "go\n");
    const [publisher, reader] = await Promise.all([publisherDone, readerDone]);
    expect(publisher.status).toBe(0);
    expect(reader.status).toBe(0);
    const detail = JSON.parse(reader.stdout) as {
      title: string;
      description: string;
      version: string;
      versionMatches: boolean;
    };
    expect(detail.versionMatches).toBe(true);
    const pairs = [
      { title: "Old title", description: "Old body\n" },
      { title: "New title", description: "New body\n" },
    ];
    expect(
      pairs.some(
        (pair) => pair.title === detail.title && pair.description === detail.description,
      ),
    ).toBe(true);
  });
});
