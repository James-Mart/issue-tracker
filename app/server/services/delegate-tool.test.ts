import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import { createDelegateCustomTools } from "./delegate-tool.js";
import { resolveModelSelection } from "./model-selection.js";
import { loadRoleBody } from "./role-bodies.js";

let agentsDir: string;
let storeDir: string;
let cwd: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), "issue-delegate-agents-"));
  storeDir = mkdtempSync(join(tmpdir(), "issue-delegate-store-"));
  cwd = mkdtempSync(join(tmpdir(), "issue-delegate-cwd-"));
  mkdirSync(agentsDir, { recursive: true });

  writeAgent(
    "pinned-role.md",
    `---
name: pinned-role
model: cursor-grok-4.5-high-fast
description: A pinned role for delegate tests.
---

You are the pinned role.

Follow the checklist.`,
  );
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("createDelegateCustomTools", () => {
  it("creates a nested agent on the role's mapped pin with the role body prepended", async () => {
    const fake = createFakeAgentSdk();
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const roleBody = loadRoleBody("pinned-role", agentsDir);
    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "do the thing" },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(fake.handles[0]!.sends).toHaveLength(1);
    expect(fake.handles[0]!.sends[0]!.prompt.startsWith(roleBody)).toBe(true);
    expect(fake.handles[0]!.sends[0]!.prompt.endsWith("do the thing")).toBe(
      true,
    );
    expect(result).toEqual({
      agentId: fake.handles[0]!.agentId,
      reply: "On it.",
    });
  });

  it("passes the same delegate tool to nested agents and handles nested delegation", async () => {
    const fake = createFakeAgentSdk();
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer work" },
      {},
    );

    const nestedTools = fake.created[0]!.customTools;
    expect(nestedTools).toBeDefined();
    expect(nestedTools!.delegate).toBe(customTools.delegate);

    const nestedResult = await nestedTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner work" },
      {},
    );

    expect(fake.created).toHaveLength(2);
    expect(fake.created[1]!.customTools?.delegate).toBe(customTools.delegate);
    expect(fake.created[1]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(nestedResult).toEqual({
      agentId: fake.handles[1]!.agentId,
      reply: "On it.",
    });
    expect(nestedResult.agentId).not.toBe(fake.handles[0]!.agentId);
  });
});
