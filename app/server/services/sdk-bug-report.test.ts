import { describe, expect, it } from "vitest";
import {
  composeReplyBody,
  composeTopicBody,
  distinctiveTerms,
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

type Queued = { status?: number; json: unknown };

/**
 * Stubs the forum so no test touches the network or the real credential.
 * Reads and writes draw from separate queues, so a test's post response cannot
 * be swallowed by a search pass — the search runs several queries per filing.
 */
function fakeForum({
  searches = [],
  writes = [],
}: { searches?: Queued[]; writes?: Queued[] } = {}) {
  const calls: Recorded[] = [];
  let keyReads = 0;

  const deps: ForumDeps = {
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        apiKey: headers["User-Api-Key"],
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const queue = method === "GET" ? searches : writes;
      const next = queue.shift() ?? { json: {} };
      return new Response(JSON.stringify(next.json), {
        status: next.status ?? 200,
      });
    }) as unknown as typeof fetch,
    readApiKey: () => {
      keyReads += 1;
      return "test-key";
    },
  };

  const searchCalls = () => calls.filter((call) => call.method === "GET");
  const writeCalls = () => calls.filter((call) => call.method !== "GET");
  return { deps, calls, searchCalls, writeCalls, keyReads: () => keyReads };
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

  it("marks every label as a heading so it renders like the template", () => {
    const body = composeTopicBody({ ...VALID, versionInfo: "sdk 1.0.24" });

    expect(body.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Where does the bug appear (feature/product)?",
      "### Describe the Bug",
      "### Steps to Reproduce",
      "### Expected Behavior",
      "### Version Information",
    ]);
    // The prose must not be swept into the heading line above it.
    expect(body).toContain(`### Describe the Bug\n${VALID.description}`);
  });

  it("includes version info only when supplied", () => {
    expect(composeTopicBody(VALID)).not.toContain("Version Information");
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

describe("distinctiveTerms", () => {
  it("keeps the rarest-looking words and drops the filler", () => {
    expect(
      distinctiveTerms(
        "ModelSelection silently ignores unrecognized fields in the SDK",
      ),
    ).toEqual(["modelselection", "unrecognized"]);
  });

  it("drops words that appear in the title of half the bug reports", () => {
    expect(distinctiveTerms("The SDK agent error is a cursor bug")).toEqual([]);
  });
});

describe("searchExistingReports", () => {
  it("maps topics to dated, linkable matches", async () => {
    const { deps } = fakeForum({
      searches: [
        {
          json: {
            topics: [
              { id: 164755, title: "SDK auth expires", created_at: "2026-01-02T03:04:05.000Z" },
            ],
          },
        },
      ],
    });

    expect(await searchExistingReports("auth", deps)).toEqual([
      {
        id: 164755,
        title: "SDK auth expires",
        createdAt: "2026-01-02",
        url: `${FORUM_BASE}/t/164755`,
      },
    ]);
  });

  it("widens past the verbatim title, since Discourse ands the terms", async () => {
    const { deps, searchCalls } = fakeForum({
      searches: [
        { json: { topics: [] } },
        { json: { topics: [{ id: 9, title: "Params dropped", created_at: "2026-02-03" }] } },
      ],
    });

    const matches = await searchExistingReports(
      "ModelSelection silently ignores unrecognized fields",
      deps,
    );

    // The exact title found nothing; a distinctive term still surfaced a report.
    expect(matches.map((m) => m.id)).toEqual([9]);
    const urls = searchCalls().map((call) => decodeURIComponent(call.url));
    expect(urls[0]).toContain("q=ModelSelection silently ignores");
    expect(urls[1]).toContain("q=modelselection category:6");
  });

  it("reports each topic once even when several queries return it", async () => {
    const hit = { json: { topics: [{ id: 9, title: "Dup", created_at: "2026-02-03" }] } };
    const { deps } = fakeForum({ searches: [hit, { ...hit }, { ...hit }] });

    const matches = await searchExistingReports("params dropped silently", deps);

    expect(matches.map((m) => m.id)).toEqual([9]);
  });
});

describe("fileSdkBugReport", () => {
  it("refuses to post while plausible duplicates exist", async () => {
    const { deps, writeCalls, keyReads } = fakeForum({
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
    expect(writeCalls()).toHaveLength(0);
    expect(keyReads()).toBe(0);
  });

  it("opens a topic in the bug category with the SDK tag when the search is empty", async () => {
    const { deps, writeCalls } = fakeForum({
      writes: [{ json: { topic_id: 42, topic_slug: "agent-stream-stalls" } }],
    });

    const result = await fileSdkBugReport(VALID, deps);

    expect(result).toEqual({
      status: "created",
      topicId: 42,
      url: `${FORUM_BASE}/t/agent-stream-stalls/42`,
    });
    const [post] = writeCalls();
    expect(post!.method).toBe("POST");
    expect(post!.apiKey).toBe("test-key");
    expect(post!.body).toMatchObject({ category: 6, tags: ["cursor-sdk"] });
  });

  it("posts untagged when the account may not apply tags", async () => {
    const { deps, writeCalls } = fakeForum({
      writes: [
        { status: 422, json: { errors: ["You're not allowed to tag topics"] } },
        { json: { topic_id: 42, topic_slug: "agent-stream-stalls" } },
      ],
    });

    const result = await fileSdkBugReport(VALID, deps);

    expect(result).toMatchObject({ status: "created", topicId: 42 });
    const [tagged, retry] = writeCalls();
    expect(tagged!.body).toMatchObject({ tags: ["cursor-sdk"] });
    // The retry drops only the tag; the report itself is unchanged.
    expect(retry!.body).not.toHaveProperty("tags");
    expect(retry!.body).toMatchObject({ title: VALID.title, category: 6 });
  });

  it("does not retry a rejection that has nothing to do with tags", async () => {
    const { deps, writeCalls } = fakeForum({
      writes: [{ status: 422, json: { errors: ["Title has already been used"] } }],
    });

    await expect(fileSdkBugReport(VALID, deps)).rejects.toThrow(
      /Forum post failed \(422\).*Title has already been used/s,
    );
    expect(writeCalls()).toHaveLength(1);
  });

  it("skips the search when the caller asserts the matches are unrelated", async () => {
    const { deps, calls } = fakeForum({
      writes: [{ json: { topic_id: 7, topic_slug: "fresh" } }],
    });

    await fileSdkBugReport({ ...VALID, unrelatedToExisting: true }, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/posts.json");
  });

  it("replies to an existing topic instead of searching", async () => {
    const { deps, calls } = fakeForum({
      writes: [{ json: { topic_id: 7, topic_slug: "existing", post_number: 3 } }],
    });

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
    const { deps } = fakeForum({
      writes: [{ status: 422, json: { errors: ["Title too short"] } }],
    });

    await expect(
      fileSdkBugReport({ ...VALID, replyToTopicId: 7 }, deps),
    ).rejects.toThrow(/Forum reply failed \(422\).*Title too short/s);
  });

  it("validates before reading the credential or calling out", async () => {
    const { deps, calls, keyReads } = fakeForum();

    await expect(
      fileSdkBugReport({ ...VALID, title: "" }, deps),
    ).rejects.toThrow(/title is required/);
    expect(calls).toHaveLength(0);
    expect(keyReads()).toBe(0);
  });
});
