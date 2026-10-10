import { afterEach, describe, expect, it, vi } from "vitest";
import { channelSessionListItem } from "../test/channel-session-list-item";
import { loadChannelSessions } from "./channel-sessions-loader";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetch(): ReturnType<typeof vi.fn> {
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
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadChannelSessions", () => {
  it("coalesces same-turn loads into one request and keeps later turns separate", async () => {
    const fetchMock = installFetch();

    const first = loadChannelSessions("alpha", "planning");
    const second = loadChannelSessions("beta", "implementing");
    const duplicate = loadChannelSessions("alpha", "planning");
    expect(fetchMock).not.toHaveBeenCalled();

    const [alpha, beta, alphaAgain] = await Promise.all([
      first,
      second,
      duplicate,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      pairs: [
        { issueId: "alpha", channel: "planning" },
        { issueId: "beta", channel: "implementing" },
      ],
    });
    expect(alpha[0]?.id).toBe("alpha-planning");
    expect(beta[0]?.id).toBe("beta-implementing");
    expect(alphaAgain).toEqual(alpha);

    await loadChannelSessions("gamma", "export");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects every waiter when the batched request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "pairs must be an array" }, 400),
      ),
    );

    const first = loadChannelSessions("alpha", "planning");
    const second = loadChannelSessions("beta", "export");
    await expect(first).rejects.toThrow("pairs must be an array");
    await expect(second).rejects.toThrow("pairs must be an array");
  });
});
