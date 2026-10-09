import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
