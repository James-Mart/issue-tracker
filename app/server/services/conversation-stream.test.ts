import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function withSeq<T extends object>(event: T): T & { seq?: number } {
  return event;
}

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-conversation-stream-"));
  issuesDir = join(root, "issues");
  mkdirSync(join(issuesDir, "platform"), { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeFileSync(
    join(issuesDir, "platform", "issue.json"),
    JSON.stringify({
      id: "platform",
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("conversation-stream catch-up buffer", () => {
  afterEach(async () => {
    vi.resetModules();
  });

  async function load() {
    return import("./conversation-stream.js");
  }

  it("answers resetRequired when sinceSeq is older than the window", async () => {
    const { publishFrame, getFramesSince, CATCHUP_BUFFER_MAX_FRAMES } =
      await load();
    for (let i = 0; i < CATCHUP_BUFFER_MAX_FRAMES + 5; i += 1) {
      publishFrame("conv-a", {
        event: { type: "assistant" as const, text: String(i) },
        persist: false,
      });
    }
    // Oldest retained is seq 6; sinceSeq 4 leaves an unservable gap at seq 5.
    expect(getFramesSince("conv-a", 4)).toEqual({ resetRequired: true });
  });
});

describe("conversation-stream sequence numbers", () => {
  async function loadConversationStream() {
    return import("./conversation-stream.js");
  }

  async function loadConversations() {
    return import("./conversations.js");
  }

  it("assigns monotonic seq without gaps across live and persisted frames", async () => {
    const { publishFrame } = await loadConversationStream();
    const { createConversation, appendEvent } = await loadConversations();

    const meta = await createConversation({
      title: "Seq mix",
      projectId: "platform",
      model: "composer-2.5",
    });

    const liveEvent = { type: "assistant" as const, text: "live delta" };
    publishFrame(meta.id, { event: liveEvent, persist: false });
    expect(liveEvent).toMatchObject({ seq: 1 });

    const persisted = await appendEvent(meta.id, {
      type: "assistant",
      text: "persisted",
    });
    expect(persisted.seq).toBe(2);

    const runEvent = withSeq({
      type: "run" as const,
      status: "started" as const,
      runId: "run-1",
    });
    publishFrame(meta.id, { event: runEvent, persist: false });
    expect(runEvent.seq).toBe(3);

    const pipelineEvent = withSeq({ type: "thinking" as const, text: "hmm" });
    publishFrame(meta.id, { event: pipelineEvent, persist: true });
    expect(pipelineEvent.seq).toBe(4);
    const fromPipeline = await appendEvent(meta.id, pipelineEvent);
    expect(fromPipeline.seq).toBe(4);
  });
});
