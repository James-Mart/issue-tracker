import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSkillPathViolations } from "./check-skill-paths.js";

const INSTALLED_PREFIX = "/root/.cursor/plugins/local/issue-tracker";
/** Path that exists in the real plugin install (instruction corpus uses absolute paths). */
const EXISTING_AGENT_PATH = `${INSTALLED_PREFIX}/agents/_issue-tracker-cli.md`;
const MISSING_AGENT_PATH = `${INSTALLED_PREFIX}/agents/__skill-path-lint-missing__.md`;

let rootDir: string;
let agentsDir: string;
let skillsDir: string;
let launchDir: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

function writeSkill(relPath: string, content: string): void {
  const full = join(skillsDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function writeLaunch(name: string, content: string): void {
  writeFileSync(join(launchDir, name), content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-skill-path-lint-"));
  agentsDir = join(rootDir, "agents");
  skillsDir = join(rootDir, "skills");
  launchDir = join(rootDir, "app/src/features/issues/lib");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(launchDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectSkillPathViolations", () => {
  it("reports only dangling literal paths and skillPath() targets", () => {
    writeAgent(
      "fixture.md",
      [
        `**Read** \`${EXISTING_AGENT_PATH}\`.`,
        `**Read** \`${MISSING_AGENT_PATH}\`.`,
      ].join("\n"),
    );

    writeSkill("valid-skill/SKILL.md", "# valid\n", "utf8");

    writeLaunch(
      "fixture-launch.ts",
      [
        'import { skillPath } from "@/lib/plugin-paths";',
        "",
        'export function message(): string {',
        '  return `Read ${skillPath("valid-skill")} and follow it.`;',
        "}",
        "",
        'export function broken(): string {',
        '  return `Read ${skillPath("missing-skill")} and follow it.`;',
        "}",
      ].join("\n"),
    );

    const violations = collectSkillPathViolations(rootDir);
    expect(violations).toHaveLength(2);

    const danglingLiteral = violations.find((v) =>
      v.target.endsWith("/__skill-path-lint-missing__.md"),
    );
    expect(danglingLiteral).toEqual({
      file: "agents/fixture.md",
      line: 2,
      target: MISSING_AGENT_PATH,
    });

    const danglingSkill = violations.find((v) =>
      v.target.endsWith("/skills/missing-skill/SKILL.md"),
    );
    expect(danglingSkill).toEqual({
      file: "app/src/features/issues/lib/fixture-launch.ts",
      line: 8,
      target: join(rootDir, "skills/missing-skill/SKILL.md"),
    });
  });

  it("trims trailing markdown punctuation from cited paths", () => {
    writeAgent(
      "fixture.md",
      `See (${INSTALLED_PREFIX}/agents/also-missing.md).`,
    );

    const violations = collectSkillPathViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.target).toBe(
      `${INSTALLED_PREFIX}/agents/also-missing.md`,
    );
  });

  it("returns no violations when every cited path resolves", () => {
    writeSkill("ok-skill/SKILL.md", "# ok\n", "utf8");

    writeAgent(
      "fixture.md",
      `**Read** \`${EXISTING_AGENT_PATH}\`.`,
    );
    writeLaunch(
      "ok-launch.ts",
      [
        'import { skillPath } from "@/lib/plugin-paths";',
        'export const m = `Read ${skillPath("ok-skill")}.`;',
      ].join("\n"),
    );

    expect(collectSkillPathViolations(rootDir)).toEqual([]);
  });
});
