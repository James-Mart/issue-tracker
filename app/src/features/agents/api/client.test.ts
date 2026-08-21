import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_FETCH_TIMEOUT_MS,
  getConversationRun,
  getConversationTranscript,
  listConversations,
} from "./client";

function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      const fail = () => {
        queueMicrotask(() => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      };
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getConversationTranscript", () => {
  it("aborts a GET that does not settle at TRANSCRIPT_FETCH_TIMEOUT_MS", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = getConversationTranscript("conv-1");
    void pending.catch(() => undefined);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(TRANSCRIPT_FETCH_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FETCH_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts when the caller signal fires first", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();

    const pending = getConversationTranscript("conv-1", undefined, caller.signal);
    void pending.catch(() => undefined);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe("other request callers", () => {
  it("do not pass the transcript timeout on getConversationRun or listConversations", async () => {
    const fetchMock = vi.fn((input: string) => {
      if (String(input).endsWith("/run")) {
        return Promise.resolve(
          jsonResponse({ active: false, runId: null, startedAt: null }),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    await getConversationRun("conv-1");
    await listConversations();

    expect(AbortSignal.timeout).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map((call) => call[1]?.signal)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
