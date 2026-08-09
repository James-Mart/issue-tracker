import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectCliFormViolations } from "./check-instruction-cli.js";

let rootDir: string;
let agentsDir: string;
let skillsDir: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

function writeSkill(relPath: string, content: string): void {
  const full = join(skillsDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-cli-form-lint-"));
  agentsDir = join(rootDir, "agents");
  skillsDir = join(rootDir, "skills");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectCliFormViolations", () => {
  it("flags a placeholder kind before a kind-uniform verb", () => {
    writeAgent(
      "fixture.md",
      "Run `issue <kind> view <id>` then continue.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("agents/fixture.md:1:");
    expect(violations[0]).toContain("issue <kind> view");
    expect(violations[0]).toContain("use: issue view <id>");
  });

  it("flags a non-<kind> placeholder after issue list", () => {
    writeSkill(
      "fixture/SKILL.md",
      "Enumerate with `issue list <projectId>`.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("skills/fixture/SKILL.md:1:");
    expect(violations[0]).toContain("issue list <projectId>");
    expect(violations[0]).toContain("use: issue list --in <id>");
  });

  it("allows issue list <kind>", () => {
    writeAgent("fixture.md", "Filter with `issue list <kind>`.\n");

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });

  it("allows a clean literal-kind call", () => {
    writeSkill(
      "fixture/SKILL.md",
      "Read merge base: `issue story get <storyId> mergeBase`.\n",
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });

  it("does not flag placeholder kinds on kind-scoped verbs", () => {
    writeAgent(
      "fixture.md",
      [
        "`issue <kind> set <id> status done`",
        "`issue <rootKind> add --title x`",
        "`issue <sourceKind> delete <id>`",
      ].join("\n"),
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });

  it("allows literal list kind and --in scope", () => {
    writeAgent(
      "fixture.md",
      [
        "`issue list story --in <projectId>`",
        "`issue list --in <projectId>`",
      ].join("\n"),
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });
});
