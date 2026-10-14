import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-sandbox-"));
  mkdirSync(join(root, "issues"), { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", join(root, "issues"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("installSandboxPackages", () => {
  it("installs each package at the nearest declared range", async () => {
    writeJson(join(root, "conversations", "conv", "meta.json"), {
      agentId: "conv-agent",
    });
    const target = join(root, "target");
    writeJson(join(target, "package.json"), {
      dependencies: { once: "1.4.0" },
    });
    writeJson(join(target, "packages", "ui", "package.json"), {
      dependencies: { clsx: "^2.1.1" },
    });
    const from = join(target, "packages", "ui", "src", "Button.tsx");
    mkdirSync(dirname(from), { recursive: true });
    writeFileSync(from, "");
    const runNpm = vi.fn();
    const { installSandboxPackages } = await import("./mockup-sandbox.js");

    const result = installSandboxPackages(
      { conversationId: "conv", from, packages: ["clsx", "once"] },
      runNpm,
    );

    const scratch = join(root, "conversations", "conv", "mockups");
    expect(result).toEqual({
      installed: [
        { name: "clsx", range: "^2.1.1" },
        { name: "once", range: "1.4.0" },
      ],
    });
    expect(runNpm).toHaveBeenCalledWith({
      cwd: scratch,
      args: ["install", "--ignore-scripts", "--cache", join(scratch, ".npm")],
    });
    expect(JSON.parse(readFileSync(join(scratch, "package.json"), "utf8"))).toMatchObject({
      dependencies: { clsx: "^2.1.1", once: "1.4.0" },
    });
  });
});
