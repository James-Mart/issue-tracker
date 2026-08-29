import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_FETCH_TIMEOUT_MS,
  conversationAttachmentApiPath,
  getConversationRun,
  getConversationTranscript,
  listConversations,
  uploadConversationAttachment,
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

describe("conversationAttachmentApiPath", () => {
  it("builds item paths with consistent encoding", () => {
    expect(conversationAttachmentApiPath("conv-1", "mock.tsx")).toBe(
      "/api/conversations/conv-1/attachments/mock.tsx",
    );
    expect(conversationAttachmentApiPath("conv-1", "a b.png")).toBe(
      "/api/conversations/conv-1/attachments/a%20b.png",
    );
    expect(conversationAttachmentApiPath("conv/special", "file.txt")).toBe(
      "/api/conversations/conv%2Fspecial/attachments/file.txt",
    );
  });
});

describe("uploadConversationAttachment", () => {
  it("posts multipart form data with field attachment and returns metadata", async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.has("attachment")).toBe(true);
      expect(form.get("attachment")).toBeInstanceOf(File);
      expect((form.get("attachment") as File).name).toBe("shot.png");

      return Promise.resolve(
        jsonResponse({
          name: "shot.png",
          size: 42,
          mimeType: "image/png",
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pixels"], "shot.png", { type: "image/png" });
    await expect(
      uploadConversationAttachment("conv-1", file),
    ).resolves.toEqual({
      name: "shot.png",
      size: 42,
      mimeType: "image/png",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/conversations/conv-1/attachments",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
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
