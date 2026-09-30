import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function mockExit() {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  return { exit, error };
}

async function loadBoot(): Promise<typeof import("./guest-boot.js")> {
  vi.resetModules();
  return import("./guest-boot.js");
}

describe("guest boot guard", () => {
  it("continues when guest is off even if AGENT_STACK_DATA_DIR is unset", async () => {
    const issues = tempDir("guest-issues-");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "");
    vi.stubEnv("ISSUES_DIR", issues);
    vi.stubEnv("AGENT_STACK_DATA_DIR", "");
    const { exit } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits when guest is on and AGENT_STACK_DATA_DIR is unset, naming both paths", async () => {
    const issues = tempDir("guest-issues-");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", issues);
    const { exit, error } = mockExit();
    const { assertGuestBoot } = await loadBoot();
    const previous = process.env.AGENT_STACK_DATA_DIR;
    delete process.env.AGENT_STACK_DATA_DIR;
    try {
      expect(() => assertGuestBoot()).toThrow("exit 1");
    } finally {
      if (previous === undefined) delete process.env.AGENT_STACK_DATA_DIR;
      else process.env.AGENT_STACK_DATA_DIR = previous;
    }
    expect(exit).toHaveBeenCalledWith(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain(realpathSync(issues));
    expect(message).toContain("AGENT_STACK_DATA_DIR unset");
  });

  it("exits when the real issues path is outside the real data dir", async () => {
    const data = tempDir("guest-data-");
    const outside = tempDir("guest-out-");
    const issues = join(outside, "issues");
    mkdirSync(issues);
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", issues);
    vi.stubEnv("AGENT_STACK_DATA_DIR", data);
    const { error } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).toThrow("exit 1");
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain(realpathSync(issues));
    expect(message).toContain(realpathSync(data));
  });

  it("exits when a symlink inside the data dir points at a store outside it", async () => {
    const data = tempDir("guest-data-");
    const outside = tempDir("guest-out-");
    const outsideIssues = join(outside, "issues");
    mkdirSync(outsideIssues);
    const link = join(data, "issues");
    symlinkSync(outsideIssues, link);
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", link);
    vi.stubEnv("AGENT_STACK_DATA_DIR", data);
    const { error } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).toThrow("exit 1");
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain(realpathSync(outsideIssues));
    expect(message).not.toContain(`${realpathSync(data)}/issues`);
  });

  it("allows a store whose real path is inside the data dir when the env path is a symlink", async () => {
    const data = tempDir("guest-data-");
    const issues = join(data, "issues");
    mkdirSync(issues);
    const outside = tempDir("guest-out-");
    const dataLink = join(outside, "data-link");
    symlinkSync(data, dataLink);
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", issues);
    vi.stubEnv("AGENT_STACK_DATA_DIR", dataLink);
    const { exit } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("treats a directory named ..foo as inside the data dir", async () => {
    const data = tempDir("guest-data-");
    const issues = join(data, "..foo");
    mkdirSync(issues);
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", issues);
    vi.stubEnv("AGENT_STACK_DATA_DIR", data);
    const { exit } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses when the issues path equals the data dir", async () => {
    const data = tempDir("guest-data-");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", data);
    vi.stubEnv("AGENT_STACK_DATA_DIR", data);
    mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).toThrow("exit 1");
  });

  it("names a missing issues directory instead of a containment failure", async () => {
    const data = tempDir("guest-data-");
    const issues = join(data, "missing-issues");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.stubEnv("ISSUES_DIR", issues);
    vi.stubEnv("AGENT_STACK_DATA_DIR", data);
    const { error } = mockExit();
    const { assertGuestBoot } = await loadBoot();

    expect(() => assertGuestBoot()).toThrow("exit 1");
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain(`${resolve(issues)} is missing`);
    expect(message).toContain(realpathSync(data));
    expect(message).not.toContain("is not under");
  });
});
