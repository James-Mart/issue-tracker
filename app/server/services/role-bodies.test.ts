import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRoleBody, validateRoleBodies } from "./role-bodies.js";

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
});
