import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";

const AT = "2026-07-09T14:00:00.000Z";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function seed(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: root,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "Ship it",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function resumeMessage(): Promise<string> {
  const { implementingResumePrompt } = await import("./implementing-launch.js");
  return implementingResumePrompt();
}

function stubSessions(prompts: string[]): AgentSessions {
  return {
    getActiveRun: () => undefined,
    sendPrompt: async (_id: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { ok: true as const, run: { id: "run-1" } as never };
    },
  } as unknown as AgentSessions;
}

describe("bringInCoordinator", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-bring-in-coordinator-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    seed();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("starts an implementing session when every coordinator conversation is archived", async () => {
    const prompts: string[] = [];
    const { createConversation, listConversations, updateMeta } = await import(
      "./conversations.js"
    );
    const { bringInCoordinator } = await import("./bring-in-coordinator.js");
    const { implementingSessionMessage } = await import("./implementing-launch.js");
    const message = await resumeMessage();
    const archived = await createConversation({
      title: "Old",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
      message: "earlier",
    });
    await updateMeta(archived.id, { archived: true });

    await bringInCoordinator("e", message, stubSessions(prompts));

    expect(prompts).toEqual([`${implementingSessionMessage("e")}\n\n${message}`]);
    const metas = listConversations().filter(
      (meta) => meta.channel === "implementing",
    );
    expect(metas).toHaveLength(2);
    expect(metas.find((meta) => meta.id === archived.id)?.archived).toBe(true);
    const active = metas.find((meta) => !meta.archived);
    expect(active).toMatchObject({
      issueId: "e",
      channel: "implementing",
      title: "Implement Ship it",
    });
  });

  it("delivers a new turn to an idle coordinator", async () => {
    const prompts: string[] = [];
    const { createConversation, listConversations, readConversation } =
      await import("./conversations.js");
    const { bringInCoordinator } = await import("./bring-in-coordinator.js");
    const message = await resumeMessage();
    const existing = await createConversation({
      title: "Implement Ship it",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
    });

    await bringInCoordinator("e", `  ${message}  `, stubSessions(prompts));

    expect(prompts).toEqual([message]);
    expect(
      listConversations().filter(
        (meta) => meta.channel === "implementing" && !meta.archived,
      ),
    ).toEqual([expect.objectContaining({ id: existing.id })]);
    expect(
      readConversation(existing.id).transcript.filter(
        (event) => event.type === "prompt",
      ),
    ).toEqual([expect.objectContaining({ text: message })]);
  });

  it("steers a coordinator that is mid-turn", async () => {
    const { createConversation } = await import("./conversations.js");
    const { bringInCoordinator } = await import("./bring-in-coordinator.js");
    const message = await resumeMessage();
    const existing = await createConversation({
      title: "Implement Ship it",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
    });
    const steers: string[] = [];
    const sessions = {
      getActiveRun: (id: string) =>
        id === existing.id
          ? {
              id: "run",
              startedAt: AT,
              steer: async (text: string) => {
                steers.push(text);
                return "complete_delivered" as const;
              },
              wait: async () => ({ id: "run", status: "finished" as const }),
            }
          : undefined,
      sendPrompt: async () => {
        throw new Error("sendPrompt should not run");
      },
    } as unknown as AgentSessions;

    await bringInCoordinator("e", message, sessions);

    expect(steers).toEqual([message]);
  });

  it("queues the message when a live steer is not accepted", async () => {
    const { createConversation, readConversation } = await import(
      "./conversations.js"
    );
    const { bringInCoordinator } = await import("./bring-in-coordinator.js");
    const message = await resumeMessage();
    const existing = await createConversation({
      title: "Implement Ship it",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
    });
    const sessions = {
      getActiveRun: (id: string) =>
        id === existing.id
          ? {
              id: "run",
              startedAt: AT,
              steer: async () => "revert_to_followup" as const,
              wait: async () => ({ id: "run", status: "finished" as const }),
            }
          : undefined,
      sendPrompt: async () => {
        throw new Error("sendPrompt should not run");
      },
    } as unknown as AgentSessions;

    await bringInCoordinator("e", message, sessions);

    expect(readConversation(existing.id).meta.pendingMessage?.text).toBe(message);
    expect(
      readConversation(existing.id).transcript.filter(
        (event) => event.type === "prompt",
      ),
    ).toEqual([]);
  });
});
