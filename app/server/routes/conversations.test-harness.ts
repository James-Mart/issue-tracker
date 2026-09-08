import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import express from "express";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";

export const AT = "2026-07-24T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
export let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

export function conversationsDir(): string {
  return join(dirname(issuesRoot), "conversations");
}

export type HeldConversationRouter = {
  server: Server;
  baseUrl: string;
  sessions: AgentSessions;
  releaseHold: () => void;
};

/** Router + sessions with a held in-flight run (shared by cancel and run-state tests). */
export async function startHeldConversationRouter(): Promise<HeldConversationRouter> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fake = createFakeAgentSdk({
    stream: buildScriptedStreamWithAgentIdHint(),
    hold,
  });
  const { createAgentSessions } = await import("../services/agent-sessions.js");
  const { createConversationsRouter } = await import("./conversations.js");
  const { errorHandler } = await import("../errors.js");
  const sessions = createAgentSessions(fake);
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", createConversationsRouter(sessions));
  app.use(errorHandler);

  let heldServer: Server;
  await new Promise<void>((resolve) => {
    heldServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = heldServer!.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }

  return {
    server: heldServer!,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    sessions,
    releaseHold: release,
  };
}

export function useConversationsTestFixtures(): void {
  beforeEach(async () => {
    // Nest issues/ under a unique root so conversations/ stays per-test. Using a
    // mkdtemp as ISSUES_DIR directly shared tmpdir()/conversations across workers
    // and the old afterEach wiped that shared dir (flake under parallel npm test).
    root = mkdtempSync(join(tmpdir(), "issue-tracker-conversations-route-"));
    issuesRoot = join(root, "issues");
    mkdirSync(issuesRoot, { recursive: true });
    workspaceDir = mkdtempSync(join(tmpdir(), "issue-conv-ws-"));
    mkdirSync(join(workspaceDir, ".git"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesRoot);

    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      workspace: workspaceDir,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("no-ws", {
      kind: "project",
      title: "No workspace",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });

    const { createApp } = await import("../app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    const { agentSessions } = await import("../services/agent-sessions.js");
    await agentSessions.disposeAll();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(root, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });
}
