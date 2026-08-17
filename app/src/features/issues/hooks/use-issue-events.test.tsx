// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTransportForTests } from "@/lib/ws/transport";
import { FakeWebSocket } from "@/lib/ws/websocket.fake";
import { issuesKeys } from "../api/keys";
import { useIssueEvents } from "./use-issue-events";

function Probe() {
  useIssueEvents();
  return null;
}

function mountHook(): {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { root, container, client, invalidateSpy };
}

function unmountHook(mounted: {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}): void {
  act(() => {
    mounted.root.unmount();
  });
  mounted.client.clear();
  mounted.container.remove();
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.reset();
  resetTransportForTests();
});

afterEach(() => {
  resetTransportForTests();
  FakeWebSocket.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useIssueEvents", () => {
  it("subscribes to the issues topic and invalidates detail on change", () => {
    const mounted = mountHook();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.emitOpen();
    });
    expect(ws.sent).toEqual([{ type: "subscribe", topic: "issues" }]);

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "issues",
        seq: 1,
        event: { type: "change", id: "platform", scope: "issue" },
      });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.detail("platform"),
    });
    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.list(),
    });

    unmountHook(mounted);
  });

  it("invalidates list and detail on planning-run scope", () => {
    const mounted = mountHook();
    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.emitOpen();
    });

    act(() => {
      ws.emitMessage({
        type: "event",
        topic: "issues",
        seq: 1,
        event: { type: "change", id: "capture", scope: "planning-run" },
      });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.detail("capture"),
    });
    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.list(),
    });

    unmountHook(mounted);
  });

  it("resyncs all issue queries on topic reset", () => {
    const mounted = mountHook();
    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.emitOpen();
    });

    act(() => {
      ws.emitMessage({ type: "reset", topic: "issues" });
    });

    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.all,
    });

    unmountHook(mounted);
  });
});
