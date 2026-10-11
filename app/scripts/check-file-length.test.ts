import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectFileLengthViolations,
  FILE_LENGTH_LIMIT,
} from "./check-file-length.js";

let rootDir: string;
let appDir: string;
let agentsDir: string;
let skillsDir: string;

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

function writeApp(relPath: string, content: string): void {
  const full = join(appDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

function writeSkill(relPath: string, content: string): void {
  const full = join(skillsDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-file-length-lint-"));
  appDir = join(rootDir, "app");
  agentsDir = join(rootDir, "agents");
  skillsDir = join(rootDir, "skills");
  mkdirSync(appDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectFileLengthViolations", () => {
  it("reports over-limit files under app/, agents/, and skills/", () => {
    writeApp("src/oversized.ts", lines(FILE_LENGTH_LIMIT + 1));
    writeAgent("oversized.md", lines(FILE_LENGTH_LIMIT + 5));
    writeSkill("oversized-skill/SKILL.md", lines(FILE_LENGTH_LIMIT + 10));

    const violations = collectFileLengthViolations(rootDir);
    expect(violations).toHaveLength(3);
    expect(violations).toEqual([
      {
        file: "agents/oversized.md",
        lines: FILE_LENGTH_LIMIT + 5,
        kind: "over-limit",
      },
      {
        file: "app/src/oversized.ts",
        lines: FILE_LENGTH_LIMIT + 1,
        kind: "over-limit",
      },
      {
        file: "skills/oversized-skill/SKILL.md",
        lines: FILE_LENGTH_LIMIT + 10,
        kind: "over-limit",
      },
    ]);
  });
});
