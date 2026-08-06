import { describe, expect, it } from "vitest";
import {
  composeReplyBody,
  composeTopicBody,
  fileSdkBugReport,
  FORUM_BASE,
  searchExistingReports,
  validateSdkBugReport,
  type ForumDeps,
  type SdkBugReportInput,
} from "./sdk-bug-report.js";

const VALID: SdkBugReportInput = {
  title: "Agent stream stalls after resume",
  description: "The stream emits no events once an agent is resumed.",
  reproduction: "Resume an agent, send a prompt, watch nothing arrive.",
  expected: "The resumed agent streams its reply.",
};

type Recorded = {
  url: string;
  method: string;
  apiKey: string | undefined;
  body: Record<string, unknown> | undefined;
};

/** Stubs the forum so no test touches the network or the real credential. */
function fakeForum(queued: { status?: number; json: unknown }[]) {
  const calls: Recorded[] = [];
  let keyReads = 0;

  const deps: ForumDeps = {
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        apiKey: headers["User-Api-Key"],
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = queued.shift() ?? { json: {} };
      return new Response(JSON.stringify(next.json), {
        status: next.status ?? 200,
      });
    }) as unknown as typeof fetch,
    readApiKey: () => {
      keyReads += 1;
      return "test-key";
    },
  };

  return { deps, calls, keyReads: () => keyReads };
}

describe("validateSdkBugReport", () => {
  it("accepts a terse, first-person report", () => {
    expect(() => validateSdkBugReport(VALID)).not.toThrow();
  });

  it("rejects a blank required field", () => {
    expect(() => validateSdkBugReport({ ...VALID, title: "   " })).toThrow(
      /title is required/,
    );
  });

  it("rejects a field over its word budget and names the budget", () => {
    const overBudget = Array.from({ length: 51 }, () => "word").join(" ");
    expect(() =>
      validateSdkBugReport({ ...VALID, expected: overBudget }),
    ).toThrow(/expected is 51 words; the budget is 50/);
  });

  it("rejects plural first person", () => {
    expect(() =>
      validateSdkBugReport({
        ...VALID,
        description: "We see the stream stall after a resume.",
      }),
    ).toThrow(/first person singular/);
  });
});

describe("composeTopicBody", () => {
  it("pins the product area and follows the form-template order", () => {
    const body = composeTopicBody(VALID);

    expect(body).toContain("Where does the bug appear (feature/product)?");
    expect(body).toContain("Cursor SDK");
    expect(body.indexOf("Describe the Bug")).toBeLessThan(
      body.indexOf("Steps to Reproduce"),
    );
    expect(body.indexOf("Steps to Reproduce")).toBeLessThan(
      body.indexOf("Expected Behavior"),
    );
  });

  it("includes version info only when supplied", () => {
    expect(composeTopicBody(VALID)).not.toContain("Version info");
    expect(
      composeTopicBody({ ...VALID, versionInfo: "sdk 0.9.1, node 20" }),
    ).toContain("sdk 0.9.1, node 20");
  });
});

describe("composeReplyBody", () => {
  it("drops the template headers a reply does not need", () => {
    const body = composeReplyBody(VALID);

    expect(body).not.toContain("Describe the Bug");
    expect(body).toContain(VALID.description);
    expect(body).toContain(VALID.reproduction);
  });
});

describe("searchExistingReports", () => {
  it("maps topics to dated, linkable matches", async () => {
    const { deps } = fakeForum([
      {
        json: {
          topics: [
            { id: 164755, title: "SDK auth expires", created_at: "2026-01-02T03:04:05.000Z" },
          ],
        },
      },
    ]);

    expect(await searchExistingReports("auth", deps)).toEqual([
      {
        id: 164755,
        title: "SDK auth expires",
        createdAt: "2026-01-02",
        url: `${FORUM_BASE}/t/164755`,
      },
    ]);
  });
});

describe("fileSdkBugReport", () => {
  it("refuses to post while plausible duplicates exist", async () => {
    const { deps, calls, keyReads } = fakeForum([
      { json: { topics: [{ id: 1, title: "Same bug", created_at: "2026-01-02" }] } },
    ]);

    const result = await fileSdkBugReport(VALID, deps);

    expect(result).toEqual({
      status: "duplicates_found",
      candidates: [
        { id: 1, title: "Same bug", createdAt: "2026-01-02", url: `${FORUM_BASE}/t/1` },
      ],
    });
    // Search only: nothing was posted and the credential was never read.
    expect(calls).toHaveLength(1);
    expect(keyReads()).toBe(0);
  });

  it("opens a topic in the bug category with the SDK tag when the search is empty", async () => {
    const { deps, calls } = fakeForum([
      { json: { topics: [] } },
      { json: { topic_id: 42, topic_slug: "agent-stream-stalls" } },
    ]);

    const result = await fileSdkBugReport(VALID, deps);

    expect(result).toEqual({
      status: "created",
      topicId: 42,
      url: `${FORUM_BASE}/t/agent-stream-stalls/42`,
    });
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.apiKey).toBe("test-key");
    expect(calls[1]!.body).toMatchObject({ category: 6, tags: ["cursor-sdk"] });
  });

  it("skips the search when the caller asserts the matches are unrelated", async () => {
    const { deps, calls } = fakeForum([
      { json: { topic_id: 7, topic_slug: "fresh" } },
    ]);

    await fileSdkBugReport({ ...VALID, unrelatedToExisting: true }, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/posts.json");
  });

  it("replies to an existing topic instead of searching", async () => {
    const { deps, calls } = fakeForum([
      { json: { topic_id: 7, topic_slug: "existing", post_number: 3 } },
    ]);

    const result = await fileSdkBugReport({ ...VALID, replyToTopicId: 7 }, deps);

    expect(result).toEqual({
      status: "replied",
      topicId: 7,
      url: `${FORUM_BASE}/t/existing/7/3`,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ topic_id: 7 });
  });

  it("surfaces a forum rejection instead of reporting success", async () => {
    const { deps } = fakeForum([{ status: 422, json: { errors: ["Title too short"] } }]);

    await expect(
      fileSdkBugReport({ ...VALID, replyToTopicId: 7 }, deps),
    ).rejects.toThrow(/Forum reply failed \(422\).*Title too short/s);
  });

  it("validates before reading the credential or calling out", async () => {
    const { deps, calls, keyReads } = fakeForum([]);

    await expect(
      fileSdkBugReport({ ...VALID, title: "" }, deps),
    ).rejects.toThrow(/title is required/);
    expect(calls).toHaveLength(0);
    expect(keyReads()).toBe(0);
  });
});
