import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("retains unpersisted frames for late subscribers", async () => {
    const { publishFrame, getBufferedFrames } = await load();
    const frame = {
      event: { type: "assistant" as const, text: "delta" },
      persist: false,
    };
    publishFrame("conv-a", frame);
    expect(getBufferedFrames("conv-a")).toEqual([
      { event: { type: "assistant", text: "delta", seq: 1 }, persist: false },
    ]);
  });

  it("clears the buffer when a persisted frame is appended", async () => {
    const { publishFrame, getBufferedFrames } = await load();
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "chunk" },
      persist: false,
    });
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "final" },
      persist: true,
    });
    expect(getBufferedFrames("conv-a")).toEqual([]);
  });

  it("caps the buffer at a fixed frame count, dropping oldest first", async () => {
    const { publishFrame, getBufferedFrames, CATCHUP_BUFFER_MAX_FRAMES } =
      await load();
    for (let i = 0; i < CATCHUP_BUFFER_MAX_FRAMES + 5; i += 1) {
      publishFrame("conv-a", {
        event: { type: "assistant" as const, text: String(i) },
        persist: false,
      });
    }
    const buffered = getBufferedFrames("conv-a");
    expect(buffered).toHaveLength(CATCHUP_BUFFER_MAX_FRAMES);
    expect(buffered[0]?.event).toMatchObject({ text: "5", seq: 6 });
    expect(buffered.at(-1)?.event).toMatchObject({
      text: String(CATCHUP_BUFFER_MAX_FRAMES + 4),
      seq: CATCHUP_BUFFER_MAX_FRAMES + 5,
    });
  });

  it("drops a conversation buffer on clearCatchupBuffer", async () => {
    const { publishFrame, getBufferedFrames, clearCatchupBuffer } =
      await load();
    publishFrame("conv-a", {
      event: { type: "run" as const, status: "started" as const, runId: "r1" },
      persist: false,
    });
    clearCatchupBuffer("conv-a");
    expect(getBufferedFrames("conv-a")).toEqual([]);
  });
});

describe("conversation-stream sequence numbers", () => {
  async function loadConversationStream() {
    return import("./conversation-stream.js");
  }

  async function loadConversations() {
    return import("./conversations.js");
  }

  async function loadConfig() {
    return import("../config.js");
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

    const runEvent = {
      type: "run" as const,
      status: "started" as const,
      runId: "run-1",
    };
    publishFrame(meta.id, { event: runEvent, persist: false });
    expect(runEvent.seq).toBe(3);

    const pipelineEvent = { type: "thinking" as const, text: "hmm" };
    publishFrame(meta.id, { event: pipelineEvent, persist: true });
    expect(pipelineEvent.seq).toBe(4);
    const fromPipeline = await appendEvent(meta.id, pipelineEvent);
    expect(fromPipeline.seq).toBe(4);
  });

  it("persists the same seq that publishFrame stamped on error-style paths", async () => {
    const { publishFrame, subscribeFrames } = await loadConversationStream();
    const { createConversation, appendEvent, readConversation } =
      await loadConversations();

    const meta = await createConversation({
      title: "Error seq match",
      projectId: "platform",
      model: "composer-2.5",
    });

    const event = { type: "error" as const, message: "send failed" };
    const streamed: Array<{ event: { seq?: number; message?: string } }> = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      streamed.push(frame);
    });

    publishFrame(meta.id, { event, persist: true });
    const persisted = await appendEvent(meta.id, event);
    unsubscribe();

    expect(persisted.seq).toBe(event.seq);
    expect(streamed).toHaveLength(1);
    expect(streamed[0]?.event).toMatchObject({
      seq: persisted.seq,
      message: "send failed",
    });

    const { transcript } = readConversation(meta.id);
    expect(transcript.at(-1)?.seq).toBe(persisted.seq);
  });

  it("continues from the highest seq already stored after reload", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, appendEvent } = await loadConversations();

    const meta = await createConversation({
      title: "Seq reload",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendEvent(meta.id, { type: "prompt", text: "one" });
    await appendEvent(meta.id, { type: "assistant", text: "two" });

    const transcriptPath = join(conversationsDir, meta.id, "transcript.jsonl");
    const lines = readFileSync(transcriptPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((row) => row.seq)).toEqual([1, 2]);

    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);

    const { publishFrame } = await loadConversationStream();
    const { appendEvent: appendAfterReload } = await loadConversations();

    const liveOnly = { type: "pending" as const, text: "queued" };
    publishFrame(meta.id, { event: liveOnly, persist: false });
    expect(liveOnly.seq).toBe(3);

    const third = await appendAfterReload(meta.id, {
      type: "assistant",
      text: "three",
    });
    expect(third.seq).toBe(4);
  });

  it("treats legacy transcript line order as seq on first read", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, readConversation, appendEvent } =
      await loadConversations();

    const meta = await createConversation({
      title: "Legacy seq",
      projectId: "platform",
      model: "composer-2.5",
    });

    const transcriptPath = join(conversationsDir, meta.id, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "prompt",
          text: "legacy one",
          at: "2026-01-01T00:00:00.000Z",
        }),
        JSON.stringify({
          type: "assistant",
          text: "legacy two",
          at: "2026-01-01T00:00:01.000Z",
        }),
      ].join("\n") + "\n",
    );

    const { transcript } = readConversation(meta.id);
    expect(transcript.map((event) => event.seq)).toEqual([1, 2]);

    const next = await appendEvent(meta.id, {
      type: "assistant",
      text: "after legacy",
    });
    expect(next.seq).toBe(3);
  });
});
