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

  it("retains frames for late subscribers", async () => {
    const { publishFrame, getFramesSince } = await load();
    const frame = {
      event: { type: "assistant" as const, text: "delta" },
      persist: false,
    };
    publishFrame("conv-a", frame);
    const late = getFramesSince("conv-a", 0);
    expect(late.resetRequired).toBe(false);
    if (late.resetRequired) return;
    expect(late.frames).toHaveLength(1);
    expect(late.frames[0]).toMatchObject({
      event: { type: "assistant", text: "delta", seq: 1 },
      persist: false,
    });
    expect(typeof (late.frames[0]!.event as { at?: string }).at).toBe("string");
  });

  it("retains frames across a persisted append", async () => {
    const { publishFrame, getFramesSince } = await load();
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "chunk" },
      persist: false,
    });
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "final" },
      persist: true,
    });
    const retained = getFramesSince("conv-a", 0);
    expect(retained.resetRequired).toBe(false);
    if (retained.resetRequired) return;
    expect(retained.frames).toHaveLength(2);
    expect(retained.frames[0]).toMatchObject({
      event: { type: "assistant", text: "chunk", seq: 1 },
      persist: false,
    });
    expect(retained.frames[1]).toMatchObject({
      event: { type: "assistant", text: "final", seq: 2 },
      persist: true,
    });
  });

  it("serves frames after sinceSeq in order", async () => {
    const { publishFrame, getFramesSince } = await load();
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "one" },
      persist: false,
    });
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "two" },
      persist: true,
    });
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "three" },
      persist: false,
    });
    const after = getFramesSince("conv-a", 1);
    expect(after.resetRequired).toBe(false);
    if (after.resetRequired) return;
    expect(after.frames).toHaveLength(2);
    expect(after.frames[0]).toMatchObject({
      event: { type: "assistant", text: "two", seq: 2 },
      persist: true,
    });
    expect(after.frames[1]).toMatchObject({
      event: { type: "assistant", text: "three", seq: 3 },
      persist: false,
    });
  });

  it("returns nothing when sinceSeq is already current", async () => {
    const { publishFrame, getFramesSince } = await load();
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "only" },
      persist: false,
    });
    expect(getFramesSince("conv-a", 1)).toEqual({
      resetRequired: false,
      frames: [],
    });
  });

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

  it("caps the buffer at a fixed frame count, dropping oldest first", async () => {
    const { publishFrame, getFramesSince, CATCHUP_BUFFER_MAX_FRAMES } =
      await load();
    for (let i = 0; i < CATCHUP_BUFFER_MAX_FRAMES + 5; i += 1) {
      publishFrame("conv-a", {
        event: { type: "assistant" as const, text: String(i) },
        persist: false,
      });
    }
    const result = getFramesSince("conv-a", 5);
    expect(result.resetRequired).toBe(false);
    if (result.resetRequired) return;
    expect(result.frames).toHaveLength(CATCHUP_BUFFER_MAX_FRAMES);
    expect(result.frames[0]?.event).toMatchObject({ text: "5", seq: 6 });
    expect(result.frames.at(-1)?.event).toMatchObject({
      text: String(CATCHUP_BUFFER_MAX_FRAMES + 4),
      seq: CATCHUP_BUFFER_MAX_FRAMES + 5,
    });
  });

  it("drops a conversation buffer on clearCatchupBuffer", async () => {
    const { publishFrame, getFramesSince, clearCatchupBuffer } = await load();
    publishFrame("conv-a", {
      event: { type: "run" as const, status: "started" as const, runId: "r1" },
      persist: false,
    });
    clearCatchupBuffer("conv-a");
    expect(getFramesSince("conv-a", 0)).toEqual({
      resetRequired: false,
      frames: [],
    });
  });

  it("drops a malformed frame while still publishing a valid one", async () => {
    const { publishFrame, subscribeFrames, getFramesSince } = await load();
    const received: Array<{ event: { seq?: number; text?: string } }> = [];
    const unsubscribe = subscribeFrames("conv-a", (frame) => {
      received.push(frame);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    publishFrame("conv-a", {
      event: { type: "assistant" as const },
      persist: false,
    });
    publishFrame("conv-a", {
      event: { type: "assistant" as const, text: "ok" },
      persist: false,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "dropping malformed conversation frame:",
      "conv-a",
      expect.objectContaining({ type: "assistant", seq: 1 }),
      expect.any(String),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toMatchObject({
      type: "assistant",
      text: "ok",
      seq: 2,
    });

    const catchup = getFramesSince("conv-a", 1);
    expect(catchup.resetRequired).toBe(false);
    if (catchup.resetRequired) return;
    expect(catchup.frames).toHaveLength(1);
    expect(catchup.frames[0]?.event).toMatchObject({
      type: "assistant",
      text: "ok",
      seq: 2,
    });

    unsubscribe();
    warnSpy.mockRestore();
  });

  it("still publishes issue-topic frames without conversation schema validation", async () => {
    const { publishFrame, subscribeFrames } = await load();
    const received: Array<{ event: { type?: string; id?: string } }> = [];
    const unsubscribe = subscribeFrames("issues", (frame) => {
      received.push(frame);
    });

    publishFrame("issues", {
      event: { type: "change", id: "platform", scope: "issue" },
      persist: false,
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.event).toMatchObject({
      type: "change",
      id: "platform",
      scope: "issue",
      seq: 1,
    });

    unsubscribe();
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

  it("reuses seq already stamped on the event", async () => {
    const { publishFrame } = await loadConversationStream();
    const { createConversation, appendEvent } = await loadConversations();

    const meta = await createConversation({
      title: "Preassigned seq",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendEvent(meta.id, { type: "prompt", text: "first" });

    const event = { type: "assistant" as const, text: "live", seq: 5 };
    publishFrame(meta.id, { event, persist: false });
    expect(event.seq).toBe(5);
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
