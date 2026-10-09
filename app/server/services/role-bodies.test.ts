import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRoleWorktreeExclusive, validateRoleBodies } from "./role-bodies.js";

let agentsDir: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), "issue-role-bodies-"));
  mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
});

describe("validateRoleBodies", () => {
  it("throws naming the file when a role is missing its model pin", () => {
    writeAgent(
      "missing-pin.md",
      `---
name: missing-pin
description: No model pin.
---

Body without a pin.`,
    );

    expect(() => validateRoleBodies(agentsDir)).toThrow(/missing-pin\.md/);
    expect(() => validateRoleBodies(agentsDir)).toThrow(/missing model pin/);
  });
});

describe("loadRoleWorktreeExclusive", () => {
  it("is true only for roles marked worktree: exclusive", () => {
    writeAgent(
      "writer.md",
      `---
name: writer
model: composer-2.5
description: Writes the worktree.
worktree: exclusive
---

Body.`,
    );
    writeAgent(
      "reader.md",
      `---
name: reader
model: composer-2.5
description: Read-only.
---

Body.`,
    );

    expect(loadRoleWorktreeExclusive("writer", agentsDir)).toBe(true);
    expect(loadRoleWorktreeExclusive("reader", agentsDir)).toBe(false);
  });
});
