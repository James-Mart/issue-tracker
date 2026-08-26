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

  it("flags npx tsx cli.ts in root SPEC.md", () => {
    writeFileSync(
      join(rootDir, "SPEC.md"),
      "Run the CLI with `npx tsx cli.ts <command>`.\n",
      "utf8",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("SPEC.md:1:");
    expect(violations[0]).toContain("npx tsx cli.ts");
    expect(violations[0]).toContain("use: the issue binary");
  });

  it("flags npx tsx cli.ts in root README.md", () => {
    writeFileSync(
      join(rootDir, "README.md"),
      "Invoke via `npx tsx cli.ts issue list`.\n",
      "utf8",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("README.md:1:");
    expect(violations[0]).toContain("npx tsx cli.ts");
  });

  it("does not flag placeholder-kind CLI examples in root SPEC.md", () => {
    writeFileSync(
      join(rootDir, "SPEC.md"),
      "Example: `issue <kind> view <id>` is wrong; use `issue view <id>`.\n",
      "utf8",
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });

  it("reports existing violations when root docs are absent", () => {
    writeAgent(
      "fixture.md",
      "Run `issue <kind> view <id>` then continue.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("agents/fixture.md:1:");
    expect(violations[0]).toContain("issue <kind> view");
  });

  it("flags issues/<id>/description.md in agents", () => {
    writeAgent(
      "fixture.md",
      "Read `issues/my-task/description.md` for the spec.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("agents/fixture.md:1:");
    expect(violations[0]).toContain("issues/my-task/description.md");
    expect(violations[0]).toContain("use: the issue CLI for tracker content");
  });

  it("flags issues/<id>/issue.json in agents", () => {
    writeAgent(
      "fixture.md",
      "Never edit issues/foo/issue.json by hand.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("issues/foo/issue.json");
    expect(violations[0]).toContain(
      "agents/_issue-tracker-consult-supporting-doc.md",
    );
  });

  it("flags issues/<id>/attachments/ in agents", () => {
    writeAgent(
      "fixture.md",
      "Open issues/p/attachments/vision.md from disk.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("issues/p/attachments/");
  });

  it("flags tracker-store file paths in skills", () => {
    writeSkill(
      "fixture/SKILL.md",
      "Load issues/capture/description.md directly.\n",
    );

    const violations = collectCliFormViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("skills/fixture/SKILL.md:1:");
    expect(violations[0]).toContain("issues/capture/description.md");
  });

  it("allows a bare issues/ directory mention", () => {
    writeAgent(
      "fixture.md",
      "The gitignored `issues/` store holds tracker state.\n",
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });

  it("does not flag on-disk layout paths in root SPEC.md", () => {
    writeFileSync(
      join(rootDir, "SPEC.md"),
      "Attachments live at `issues/<id>/attachments/<basename>` on disk.\n",
      "utf8",
    );

    expect(collectCliFormViolations(rootDir)).toEqual([]);
  });
});
