// @vitest-environment happy-dom
import type {
  ConversationTranscriptPage,
  TranscriptEvent,
} from "@server/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTransportForTests } from "@/lib/ws/transport";
import { FakeWebSocket } from "@/lib/ws/websocket.fake";
import {
  applyConversationHistorySeed,
  loadOlderConversationEvents,
  resetConversationEventsRegistryForTests,
  subscribeConversation,
} from "./conversation-events-registry";
import type { ConversationEventsState } from "./conversation-events-state";

function prompt(seq: number, text = `turn ${seq}`): TranscriptEvent {
  return { type: "prompt", text, at: "2026-09-30T00:00:00.000Z", seq };
}

function page(
  events: TranscriptEvent[],
  hasMore: boolean,
  latestSeq = events.at(-1)?.seq ?? 0,
): ConversationTranscriptPage {
  return { events, latestSeq, hasMore };
}

type Deferred = {
  url: string;
  resolve: (body: ConversationTranscriptPage) => void;
  fail: () => void;
};

function deferredFetch(): { calls: Deferred[] } {
  const calls: Deferred[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: string) =>
        new Promise((resolve) => {
          calls.push({
            url: String(input),
            resolve: (body) =>
              resolve({
                ok: true,
                status: 200,
                text: async () => JSON.stringify(body),
              }),
            fail: () =>
              resolve({
                ok: false,
                status: 502,
                text: async () => JSON.stringify({ error: "bad gateway" }),
              }),
          });
        }),
    ),
  );
  return { calls };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function open(
  id: string,
  seed: ConversationTranscriptPage,
): { state: () => ConversationEventsState; close: () => void } {
  let latest!: ConversationEventsState;
  const close = subscribeConversation(id, (next) => {
    latest = next;
  }, seed);
  return { state: () => latest, close };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  FakeWebSocket.reset();
  resetTransportForTests();
  resetConversationEventsRegistryForTests();
});

afterEach(() => {
  resetConversationEventsRegistryForTests();
  resetTransportForTests();
  FakeWebSocket.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadOlderConversationEvents", () => {
  it("fetches the page before the oldest loaded seq and prepends it", async () => {
    const { calls } = deferredFetch();
    const thread = open("conv-old", page([prompt(5), prompt(6)], true));
    expect(thread.state()).toMatchObject({
      hasOlder: true,
      olderStatus: "idle",
      prependedRows: 0,
    });

    loadOlderConversationEvents("conv-old");
    loadOlderConversationEvents("conv-old");

    expect(calls.map((call) => call.url)).toEqual([
      "/api/conversations/conv-old/transcript?before=5",
    ]);
    expect(thread.state().olderStatus).toBe("loading");

    calls[0]!.resolve(page([prompt(3), prompt(4)], false, 6));
    await settle();

    expect(thread.state().events.map((event) => event.seq)).toEqual([
      3, 4, 5, 6,
    ]);
    expect(thread.state()).toMatchObject({
      hasOlder: false,
      olderStatus: "idle",
      prependedRows: 2,
    });

    loadOlderConversationEvents("conv-old");
    expect(calls).toHaveLength(1);
    thread.close();
  });

  it("keeps loaded events on failure and retries the same page", async () => {
    const { calls } = deferredFetch();
    const thread = open("conv-fail", page([prompt(10)], true));

    loadOlderConversationEvents("conv-fail");
    calls[0]!.fail();
    await settle();

    expect(thread.state().olderStatus).toBe("error");
    expect(thread.state().hasOlder).toBe(true);
    expect(thread.state().events.map((event) => event.seq)).toEqual([10]);

    loadOlderConversationEvents("conv-fail");
    expect(calls[1]!.url).toBe(
      "/api/conversations/conv-fail/transcript?before=10",
    );
    expect(thread.state().olderStatus).toBe("loading");
    calls[1]!.resolve(page([prompt(9)], true, 10));
    await settle();

    expect(thread.state().events.map((event) => event.seq)).toEqual([9, 10]);
    expect(thread.state()).toMatchObject({ hasOlder: true, olderStatus: "idle" });
    thread.close();
  });
});

describe("applyConversationHistorySeed with older pages loaded", () => {
  it("replaces loaded events when unloaded events sit before the new page, and drops an in-flight older page", async () => {
    const { calls } = deferredFetch();
    const thread = open("conv-gap", page([prompt(5), prompt(6)], true));
    loadOlderConversationEvents("conv-gap");

    applyConversationHistorySeed(
      "conv-gap",
      page([prompt(20), prompt(21)], true),
    );
    expect(thread.state().events.map((event) => event.seq)).toEqual([20, 21]);
    expect(thread.state()).toMatchObject({ hasOlder: true, prependedRows: 0 });

    calls[0]!.resolve(page([prompt(3), prompt(4)], true, 21));
    await settle();

    expect(thread.state().events.map((event) => event.seq)).toEqual([20, 21]);
    expect(thread.state().olderStatus).toBe("idle");

    loadOlderConversationEvents("conv-gap");
    expect(calls[1]!.url).toBe(
      "/api/conversations/conv-gap/transcript?before=20",
    );
    thread.close();
  });
});
