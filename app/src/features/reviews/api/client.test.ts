import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewCommits } from "@server/schemas";
import { fetchReviewCommits } from "./client";

const body: ReviewCommits = {
  mergeBase: "main",
  mergeBaseRef: "abc",
  tip: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  commits: [],
};
const etag = `"3:${body.tip}"`;

function jsonResponse(
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchReviewCommits", () => {
  it("sends If-None-Match on the later poll and keeps the list on 304", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, body, { ETag: etag }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: etag } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReviewCommits("p", "poll-304")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: {} });

    await expect(fetchReviewCommits("p", "poll-304")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      headers: { "If-None-Match": etag },
    });
  });

  it("replaces the cached list when the validator misses", async () => {
    const next: ReviewCommits = { ...body, tip: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
    const nextEtag = `"4:${next.tip}"`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, body, { ETag: etag }))
      .mockResolvedValueOnce(jsonResponse(200, next, { ETag: nextEtag }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchReviewCommits("p", "poll-miss");
    await expect(fetchReviewCommits("p", "poll-miss")).resolves.toEqual(next);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      headers: { "If-None-Match": etag },
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: nextEtag } }));
    await expect(fetchReviewCommits("p", "poll-miss")).resolves.toEqual(next);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual({
      headers: { "If-None-Match": nextEtag },
    });
  });
});
