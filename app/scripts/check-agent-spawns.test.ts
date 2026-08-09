import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSpawnViolations } from "./check-agent-spawns.js";

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

const DELEGATION_READ = `**Read** \`/abs/agents/_issue-tracker-delegation.md\`.`;
const IKIGAI_READ = `**Read** \`/abs/agents/_issue-tracker-ikigai.md\`.`;

const PINNED_ROLE = `---
name: pinned-role
model: composer-2.5
description: A pinned role.
---

${IKIGAI_READ}

You are the pinned role.
`;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-spawn-lint-"));
  agentsDir = join(rootDir, "agents");
  skillsDir = join(rootDir, "skills");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  writeAgent("pinned-role.md", PINNED_ROLE);
  writeAgent(
    "_issue-tracker-delegation.md",
    "# Delegation\n\nNot a spawnable agent.\n",
  );
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectSpawnViolations — delegation vocabulary", () => {
  it("fails when a delegation names an unknown role", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

**Unknown** — \`role: no-such-role\`

> Do the thing.
`,
    );

    const violations = collectSpawnViolations(rootDir);
    expect(violations.some((v) => v.includes("role 'no-such-role'"))).toBe(
      true,
    );
    expect(
      violations.some((v) =>
        v.includes("has no matching spawnable agents/*.md file"),
      ),
    ).toBe(true);
  });

  it("fails when a delegation names a model", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

**Pinned** — \`role: pinned-role\` (\`model: composer-2.5\`)

> Do the thing.
`,
    );

    const violations = collectSpawnViolations(rootDir);
    expect(
      violations.some(
        (v) =>
          v.includes("delegation role 'pinned-role' names a model") &&
          v.includes("composer-2.5"),
      ),
    ).toBe(true);
  });

  it("passes a clean role delegation that Reads the include", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

**Pinned** — \`role: pinned-role\`

> Do the thing.
`,
    );

    expect(collectSpawnViolations(rootDir)).toEqual([]);
  });
});

describe("collectSpawnViolations — ikigai include", () => {
  it("fails when a spawnable agent omits the Ikigai Read", () => {
    writeAgent(
      "no-ikigai.md",
      `---
name: no-ikigai
model: composer-2.5
description: Missing ikigai.
---

You are a role without the framing include.
`,
    );

    const violations = collectSpawnViolations(rootDir);
    expect(
      violations.some((v) =>
        v.includes("agents/no-ikigai.md: missing **Read** of agents/_issue-tracker-ikigai.md"),
      ),
    ).toBe(true);
  });

  it("passes when every spawnable agent Reads Ikigai", () => {
    expect(collectSpawnViolations(rootDir)).toEqual([]);
  });
});
