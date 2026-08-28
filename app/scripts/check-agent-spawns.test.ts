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
  collectSpawnEdges,
  collectSpawnViolations,
} from "./check-agent-spawns.js";

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

  it("fails when a work-loop delegation omits issueId", () => {
    writeSkill(
      "issue-tracker-work/SKILL.md",
      `${DELEGATION_READ}

**Implement** — \`role: pinned-role\`

> Work root: \`<rootId>\`. Issue: \`<id>\` (\`<title>\`). Mode: implement.
`,
    );

    const violations = collectSpawnViolations(rootDir);
    expect(
      violations.some(
        (v) =>
          v.includes("skills/issue-tracker-work/SKILL.md") &&
          v.includes("omits delegate issueId argument"),
      ),
    ).toBe(true);
  });
});

describe("collectSpawnEdges", () => {
  it("returns an edge for a subagent_type stub", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

Task tool — subagent_type: pinned-role, model: composer-2.5

> Do the thing.
`,
    );

    expect(collectSpawnEdges(rootDir)).toEqual([
      {
        spawnerFile: "skills/fixture/SKILL.md",
        spawnedRole: "pinned-role",
        line: 3,
      },
    ]);
  });

  it("returns an edge for a role delegation stub", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

**Pinned** — \`role: pinned-role\`

> Do the thing.
`,
    );

    expect(collectSpawnEdges(rootDir)).toEqual([
      {
        spawnerFile: "skills/fixture/SKILL.md",
        spawnedRole: "pinned-role",
        line: 3,
      },
    ]);
  });

  it("expands a family-parameterized type to one edge per concrete role", () => {
    for (const family of ["composer", "grok", "opus"] as const) {
      writeAgent(
        `implementor-${family}.md`,
        `---
name: implementor-${family}
model: composer-2.5
description: Family wrapper.
---

${IKIGAI_READ}

You are the implementor.
`,
      );
    }

    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

Task tool — subagent_type: implementor-<family>, model from pin

> Work the issue.
`,
    );

    expect(collectSpawnEdges(rootDir)).toEqual([
      {
        spawnerFile: "skills/fixture/SKILL.md",
        spawnedRole: "implementor-composer",
        line: 3,
      },
      {
        spawnerFile: "skills/fixture/SKILL.md",
        spawnedRole: "implementor-grok",
        line: 3,
      },
      {
        spawnerFile: "skills/fixture/SKILL.md",
        spawnedRole: "implementor-opus",
        line: 3,
      },
    ]);
  });

  it("does not change collectSpawnViolations output", () => {
    writeSkill(
      "fixture/SKILL.md",
      `${DELEGATION_READ}

Task tool — subagent_type: pinned-role, model: composer-2.5

> Do the thing.
`,
    );

    const before = collectSpawnViolations(rootDir);
    collectSpawnEdges(rootDir);
    expect(collectSpawnViolations(rootDir)).toEqual(before);
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
