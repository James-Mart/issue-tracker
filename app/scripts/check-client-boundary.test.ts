import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectClientBoundaryViolations } from "./check-client-boundary.js";

let rootDir: string;
let srcDir: string;
let serverDir: string;

function writeSrc(relPath: string, content: string): void {
  const full = join(srcDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function writeServer(relPath: string, content: string): void {
  const full = join(serverDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-client-boundary-lint-"));
  srcDir = join(rootDir, "src");
  serverDir = join(rootDir, "server");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectClientBoundaryViolations", () => {
  it("reports a client chain that reaches a Node builtin", () => {
    writeServer("unsafe.ts", ['import fs from "fs";', "", "export const x = fs;", ""].join("\n"));
    writeSrc(
      "leak.ts",
      ['import { x } from "@server/unsafe";', "", "export const y = x;", ""].join("\n"),
    );

    const violations = collectClientBoundaryViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.chain.at(-1)).toBe("builtin:fs");
  });
});
