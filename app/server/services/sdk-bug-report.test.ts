import { describe, expect, it } from "vitest";
import {
  fileSdkBugReport,
  FORUM_BASE,
  type ForumDeps,
  type SdkBugReportInput,
} from "./sdk-bug-report.js";

const VALID: SdkBugReportInput = {
  title: "Agent stream stalls after resume",
  description: "The stream emits no events once an agent is resumed.",
  reproduction: "Resume an agent, send a prompt, watch nothing arrive.",
  expected: "The resumed agent streams its reply.",
};

type Queued = { json: unknown };

/** Stubs the forum so no test touches the network or the real credential. */
function fakeForum({ searches }: { searches: Queued[] }) {
  const writes: string[] = [];
  let keyReads = 0;

  const deps: ForumDeps = {
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") {
        writes.push(String(url));
      }
      const next = searches.shift() ?? { json: {} };
      return Response.json(next.json);
    }) as unknown as typeof fetch,
    readApiKey: () => {
      keyReads += 1;
      return "test-key";
    },
  };

  return { deps, writes, keyReads: () => keyReads };
}

describe("fileSdkBugReport", () => {
  it("refuses to post while plausible duplicates exist", async () => {
    const { deps, writes, keyReads } = fakeForum({
      searches: [
        { json: { topics: [{ id: 1, title: "Same bug", created_at: "2026-01-02" }] } },
      ],
    });

    const result = await fileSdkBugReport(VALID, deps);

    expect(result).toEqual({
      status: "duplicates_found",
      candidates: [
        { id: 1, title: "Same bug", createdAt: "2026-01-02", url: `${FORUM_BASE}/t/1` },
      ],
    });
    // Search only: nothing was posted and the credential was never read.
    expect(writes).toHaveLength(0);
    expect(keyReads()).toBe(0);
  });
});
