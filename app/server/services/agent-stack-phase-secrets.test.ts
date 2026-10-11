import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_SECRET_MASK } from "./agent-stack-secrets.js";

let root: string;
let issuesDir: string;
let worktree: string;
let home: string;

const STAMP = "2026-01-01T00:00:00.000Z";
const SECRET = "sk_test_echo_9f3a";

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({
      id,
      title: id,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...body,
    }),
  );
}

function nodeScript(source: string): string {
  const path = join(root, `phase-${Math.random().toString(16).slice(2)}.cjs`);
  writeFileSync(path, source);
  return `node ${JSON.stringify(path)}`;
}

function story(): void {
  writeIssue("story-a", {
    kind: "story",
    partOf: "proj",
    worktreePath: worktree,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-phase-secrets-"));
  issuesDir = join(root, "issues");
  worktree = join(root, "worktree");
  home = join(root, "home");
  mkdirSync(issuesDir, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(home, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  vi.stubEnv("HOME", home);
});

afterEach(async () => {
  const { stopAgentStack } = await import("./agent-stack.js");
  await stopAgentStack("conv");
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("project secrets in runtime phases", () => {
  it("masks a secret echoed by a phase in the tool result, state file, and server log", async () => {
    const { setSecret } = await import("./secret-store.js");
    setSecret("proj", "STRIPE_SANDBOX_KEY", SECRET);
    writeIssue("proj", {
      kind: "project",
      runtime: {
        start: nodeScript(`
          console.log(process.env.STRIPE_SANDBOX_KEY);
          const net = require("net");
          net.createServer().listen(Number(process.env.AGENT_STACK_PORT), "127.0.0.1");
          setInterval(() => {}, 1e9);
        `),
        redeploy: nodeScript(`console.log(process.env.STRIPE_SANDBOX_KEY);`),
        baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
      },
    });
    story();
    const { createAgentStackTools } = await import("./agent-stack-tools.js");
    const { agentStackDir, agentStackStatePath } = await import("./agent-stack.js");
    const tools = createAgentStackTools({
      conversationId: "conv",
      getCursorConversationId: () => "cursor-1",
    });

    const started = await tools.agent_stack_start!.execute({ issueId: "story-a" }, {});
    const logPath = join(agentStackDir("conv"), "start.log");
    const log = await waitForLog(logPath);
    const stateText = readFileSync(agentStackStatePath("conv"), "utf8");
    const redeployed = await tools.agent_stack_redeploy!.execute({}, {});

    expect(JSON.stringify(started)).not.toContain(SECRET);
    expect(JSON.stringify(redeployed)).not.toContain(SECRET);
    expect(JSON.stringify(redeployed)).toContain(PHASE_SECRET_MASK);
    expect(stateText).not.toContain(SECRET);
    expect(log).not.toContain(SECRET);
    expect(log).toContain(PHASE_SECRET_MASK);
    expect(JSON.parse(stateText).conversationId).toBe("conv");
  });
});

async function waitForLog(path: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  let text = "";
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      text = readFileSync(path, "utf8");
      if (text.includes(PHASE_SECRET_MASK)) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return text;
}
