import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(getBufferedFrames("conv-a")).toEqual([frame]);
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
    expect(buffered[0]?.event).toMatchObject({ text: "5" });
    expect(buffered.at(-1)?.event).toMatchObject({
      text: String(CATCHUP_BUFFER_MAX_FRAMES + 4),
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
