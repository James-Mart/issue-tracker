import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_FETCH_TIMEOUT_MS,
  conversationAttachmentApiPath,
  forkConversation,
  getConversationRun,
  getConversationTranscript,
  listConversations,
  transcribeAudio,
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

describe("transcribeAudio", () => {
  it("posts multipart form data with field audio and returns response text", async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.has("audio")).toBe(true);
      expect(form.get("audio")).toBeInstanceOf(Blob);

      return Promise.resolve(jsonResponse({ text: "Hello there." }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const samples = Float32Array.from([0.1, -0.2, 0.3]);
    await expect(transcribeAudio(samples)).resolves.toBe("Hello there.");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/transcriptions");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("uploads only the viewed samples when given a subarray", async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const blob = form.get("audio") as Blob;
      return blob.arrayBuffer().then((buf) => {
        expect(buf.byteLength).toBe(8);
        expect(Array.from(new Float32Array(buf))).toEqual([0.5, -0.25]);
        return jsonResponse({ text: "slice" });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const backing = Float32Array.from([0, 0.5, -0.25, 0]);
    const view = backing.subarray(1, 3);
    await expect(transcribeAudio(view)).resolves.toBe("slice");
  });
});

describe("forkConversation", () => {
  it("posts to the fork path with the seq body and returns the new id", async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ seq: 3 }));
      return Promise.resolve(jsonResponse({ id: "conv-fork-1" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(forkConversation("conv-source", { seq: 3 })).resolves.toEqual({
      id: "conv-fork-1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/conversations/conv-source/fork",
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
