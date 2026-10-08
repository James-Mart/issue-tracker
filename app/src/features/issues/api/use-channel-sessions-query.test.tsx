// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationChannel } from "@server/schemas";
import { channelSessionListItem } from "../test/channel-session-list-item";
import { issuesKeys } from "./keys";
import { useChannelSessionsQuery } from "./queries";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

function Probe({
  issueId,
  channel,
}: {
  issueId: string;
  channel: ConversationChannel;
}) {
  const query = useChannelSessionsQuery(issueId, channel);
  return <span>{query.data?.[0]?.id ?? query.status}</span>;
}

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChannelSessionsQuery", () => {
  it("keeps polling and coalesces same-turn callers into one request", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as {
        pairs: { issueId: string; channel: string }[];
      };
      const sessions: Record<string, ReturnType<typeof channelSessionListItem>[]> =
        {};
      for (const pair of parsed.pairs) {
        sessions[`${pair.issueId}:${pair.channel}`] = [
          channelSessionListItem({ id: `${pair.issueId}-${pair.channel}` }),
        ];
      }
      return jsonResponse({ sessions });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <QueryClientProvider client={client}>
          <Probe issueId="alpha" channel="planning" />
          <Probe issueId="beta" channel="implementing" />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("alpha-planning");
      expect(container.textContent).toContain("beta-implementing");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      pairs: [
        { issueId: "alpha", channel: "planning" },
        { issueId: "beta", channel: "implementing" },
      ],
    });

    const planning = client.getQueryCache().find({
      queryKey: issuesKeys.channelSessions("alpha", "planning"),
    });
    expect(planning?.options).toEqual(
      expect.objectContaining({
        refetchInterval: 15_000,
        refetchOnWindowFocus: true,
      }),
    );
  });
});
