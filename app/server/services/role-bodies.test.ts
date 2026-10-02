import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadRoleBody,
  loadRoleModelPin,
  loadRoleWorktreeExclusive,
  validateRoleBodies,
} from "./role-bodies.js";

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

describe("loadRoleBody", () => {
  it("returns the body with frontmatter removed for a well-formed role", () => {
    writeAgent(
      "pinned-role.md",
      `---
name: pinned-role
model: composer-2.5
description: A pinned role.
---

You are the pinned role.

Follow the checklist.`,
    );

    expect(loadRoleBody("pinned-role", agentsDir)).toBe(
      "You are the pinned role.\n\nFollow the checklist.",
    );
  });
});

describe("loadRoleModelPin", () => {
  it("returns the frontmatter model pin for a well-formed role", () => {
    writeAgent(
      "pinned-role.md",
      `---
name: pinned-role
model: cursor-grok-4.5-high-fast
description: A pinned role.
---

Body.`,
    );

    expect(loadRoleModelPin("pinned-role", agentsDir)).toBe(
      "cursor-grok-4.5-high-fast",
    );
  });
});

describe("validateRoleBodies", () => {
  it("skips underscore-prefixed include files", () => {
    writeAgent(
      "_shared-include.md",
      `---
name: shared-include
description: Shared include, not spawnable.
---

Include body.`,
    );
    writeAgent(
      "spawnable.md",
      `---
name: spawnable
model: composer-2.5
description: Spawnable role.
---

Spawnable body.`,
    );

    expect(() => validateRoleBodies(agentsDir)).not.toThrow();
  });

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

  it("throws naming the file when worktree is set to anything but exclusive", () => {
    writeAgent(
      "shared-writer.md",
      `---
name: shared-writer
model: composer-2.5
description: Misspelled worktree mode.
worktree: exclusve
---

Body.`,
    );

    expect(() => validateRoleBodies(agentsDir)).toThrow(
      'shared-writer.md: worktree must be "exclusive" when set',
    );
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
