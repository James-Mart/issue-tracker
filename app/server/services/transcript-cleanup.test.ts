import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  TRANSCRIPT_CLEANUP_MODEL,
  TRANSCRIPT_CLEANUP_TIMEOUT_MS,
  cleanTranscript,
} from "./transcript-cleanup.js";

function assistantStream(text: string): AgentStreamEvent[] {
  return [
    {
      kind: "message",
      message: {
        type: "assistant",
        agent_id: "agent-fake-1",
        run_id: "run-fake-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
        },
      },
    },
  ];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cleanTranscript", () => {
  it("returns a transcript with fillers removed", async () => {
    const fake = createFakeAgentSdk({
      stream: assistantStream("I think we should ship it tomorrow."),
    });

    const cleaned = await cleanTranscript(
      "Um, so, I think we should, like, ship it tomorrow.",
      fake,
    );

    expect(cleaned).toBe("I think we should ship it tomorrow.");
    const sent = fake.handles[0]!.sends[0]!.message;
    expect(sent).toEqual(
      expect.stringContaining(
        "Um, so, I think we should, like, ship it tomorrow.",
      ),
    );
    expect(sent).toMatch(/fillers/i);
    expect(sent).toMatch(/false starts/i);
    expect(sent).toMatch(/do not rephrase/i);
    expect(sent).not.toMatch(/punctuat/i);
    expect(sent).not.toMatch(/capitali/i);
  });

  it("returns the original text when the SDK call is rejected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = "So, uh, let's keep the original.";
    const fake = createFakeAgentSdk({
      sendError: new Error("sdk rejected"),
    });

    await expect(cleanTranscript(original, fake)).resolves.toBe(original);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/sdk rejected/),
    );
  });

  it("returns the original text when the call outlives the timeout", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = "This should come back unchanged.";
    const fake = createFakeAgentSdk({
      hold: new Promise(() => {}),
    });

    const pending = cleanTranscript(original, fake);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_CLEANUP_TIMEOUT_MS);

    await expect(pending).resolves.toBe(original);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`timed out after ${TRANSCRIPT_CLEANUP_TIMEOUT_MS}ms`),
      ),
    );
    expect(fake.handles[0]?.cancelled).toBe(true);
  });

  it("passes the configured model slug to the SDK", async () => {
    const fake = createFakeAgentSdk({
      stream: assistantStream("Cleaned."),
    });

    await cleanTranscript("um Cleaned.", fake);

    expect(fake.created[0]!.model).toEqual({ id: TRANSCRIPT_CLEANUP_MODEL });
    expect(TRANSCRIPT_CLEANUP_MODEL).toBe("composer-2.5-fast");
    expect(fake.created[0]!.tools).toEqual([]);
  });
});
