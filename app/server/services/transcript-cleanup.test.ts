import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  TRANSCRIPT_CLEANUP_TIMEOUT_MS,
  cleanTranscript,
} from "./transcript-cleanup.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cleanTranscript", () => {
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
});
