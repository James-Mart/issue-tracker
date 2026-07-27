import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Agent, JsonlLocalAgentStore } from "@cursor/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { createAgentSdk } from "./agent-sdk.js";

// Real `@cursor/sdk`, and still on the default lane: `Agent.create` and
// `Agent.resume` only read and write the local JSONL store here, so nothing in
// this file contacts the network, needs an API key, or spends tokens (no run is
// ever started). It earns that exception because the rule under test lives
// inside the SDK — a fake boundary cannot express it, and a mocked assertion
// that resume forwards `cwd` would keep passing even if the SDK stopped scoping
// on it.
//
// The rule: the SDK persists an agent under the workspace it was created in and
// scopes every later store lookup to the workspace the caller resumes under.
// Resuming under a different one reports `Agent <id> not found` even though the
// store is intact — which is what broke app-hosted delegation re-entry, because
// the server's own `process.cwd()` is the `app/` directory while agents run in
// the project's workspace.

const MODEL = { id: "composer-2.5" };

let workspace: string;
let otherWorkspace: string;
let storeDir: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "agent-store-scope-"));
  workspace = join(root, "workspace");
  otherWorkspace = join(root, "elsewhere");
  storeDir = join(root, "agent-state");
  for (const dir of [workspace, otherWorkspace, storeDir]) {
    mkdirSync(dir, { recursive: true });
  }
});

/** Persist an agent into {@link storeDir}, created under {@link workspace}. */
async function createStoredAgent(): Promise<string> {
  const agent = await Agent.create({
    model: MODEL,
    local: {
      cwd: workspace,
      settingSources: ["user", "project", "plugins"],
      store: new JsonlLocalAgentStore(storeDir),
    },
  });
  const { agentId } = agent;
  await agent[Symbol.asyncDispose]();
  return agentId;
}

describe("local agent store workspace scoping", () => {
  it("hides a stored agent from a resume in another workspace", async () => {
    const agentId = await createStoredAgent();

    await expect(
      Agent.resume(agentId, {
        local: {
          cwd: otherWorkspace,
          store: new JsonlLocalAgentStore(storeDir),
        },
      }),
    ).rejects.toThrow(`Agent ${agentId} not found`);
  });

  it("resumes the stored agent through the boundary's own cwd", async () => {
    const agentId = await createStoredAgent();
    const sdk = createAgentSdk({ apiKey: undefined });

    const handle = await sdk.resumeAgent(agentId, storeDir, {
      cwd: workspace,
      model: MODEL,
    });

    expect(handle.agentId).toBe(agentId);
    await handle[Symbol.asyncDispose]();
  });

  // A resumed local agent does not inherit the selection it was created with,
  // and the SDK refuses the next send rather than falling back to one — so the
  // boundary re-states the model on every re-entry.
  it("refuses to drive a resumed agent that was given no model", async () => {
    const agentId = await createStoredAgent();

    const handle = await Agent.resume(agentId, {
      local: { cwd: workspace, store: new JsonlLocalAgentStore(storeDir) },
    });

    await expect(handle.send("anything")).rejects.toThrow(
      /require an explicit `model`/,
    );
    await handle[Symbol.asyncDispose]();
  });

  it("resumes an agent the boundary created, without inheriting process.cwd()", async () => {
    const sdk = createAgentSdk({ apiKey: undefined });
    const created = await sdk.createAgent({
      cwd: workspace,
      model: MODEL,
      storeDir,
    });
    const { agentId } = created;
    await created[Symbol.asyncDispose]();

    // The condition the bug needed: the workspace the agent runs in is not the
    // directory the server process was launched from.
    expect(workspace).not.toBe(process.cwd());

    const resumed = await sdk.resumeAgent(agentId, storeDir, {
      cwd: workspace,
      model: MODEL,
    });

    expect(resumed.agentId).toBe(agentId);
    await resumed[Symbol.asyncDispose]();
  });
});
