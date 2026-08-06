import { readFileSync } from "fs";
import { join } from "path";
import type { SDKCustomTool } from "@cursor/sdk";
import { forumCredDir } from "../config.js";

/**
 * The `file_cursor_sdk_bug` custom tool: files bugs in `@cursor/sdk` on
 * forum.cursor.com as the human who authorized the key. Deliberately narrow —
 * the product area and tag are fixed, so agents cannot repurpose it for
 * general forum posting or for bugs in other Cursor surfaces.
 *
 * Two rules are enforced here rather than left to an agent's judgement,
 * because both are things models reliably get wrong:
 *
 * - **Never duplicate.** Every filing searches first and refuses to open a new
 *   topic while plausible matches exist; the caller must either reply to one
 *   or explicitly assert the match set is unrelated.
 * - **Stay terse and first-person.** Word budgets are validated, and plural
 *   first person is rejected — these post under one person's name.
 */

export const FORUM_BASE = process.env.FORUM_BASE ?? "https://forum.cursor.com";

/** Bug Reports category on forum.cursor.com (subcategory of Support). */
const BUG_REPORTS_CATEGORY = 6;

/** Fixed dropdown choice in the category's form template. */
const PRODUCT_AREA = "Cursor SDK";

/** Fixed tag, matching prior SDK reports. */
const SDK_TAG = "cursor-sdk";

/**
 * Per-field word ceilings. Deliberately tight: a report that cannot be made
 * this short usually has not been diagnosed yet.
 */
const WORD_BUDGETS = {
  title: 14,
  description: 110,
  reproduction: 120,
  expected: 50,
} as const;

export interface SdkBugReportInput {
  title: string;
  description: string;
  reproduction: string;
  expected: string;
  /** SDK version, Node version, OS, model — whatever pins the report down. */
  versionInfo?: string;
  /** Reply to this topic instead of opening a new one. */
  replyToTopicId?: number;
  /** Assert that the search hits are unrelated and a new topic is warranted. */
  unrelatedToExisting?: boolean;
}

// A type alias, not an interface: only aliases get the implicit index
// signature that makes this assignable to the SDK's `SDKJsonValue` result.
export type ForumTopicMatch = {
  id: number;
  title: string;
  createdAt: string;
  url: string;
};

export type FileSdkBugResult =
  | { status: "duplicates_found"; candidates: ForumTopicMatch[] }
  | { status: "replied"; url: string; topicId: number }
  | { status: "created"; url: string; topicId: number };

export interface ForumDeps {
  fetchImpl: typeof fetch;
  /** Resolved lazily so a missing credential only fails an actual filing. */
  readApiKey: () => string;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function readApiKeyFromDisk(): string {
  const path = join(forumCredDir, "key.json");
  try {
    const key = JSON.parse(readFileSync(path, "utf8")).key;
    if (typeof key === "string" && key.length > 0) return key;
  } catch {
    // Fall through to the shared guidance below.
  }
  throw new Error(
    `No forum credential at ${path}. Run \`node tools/forum.mjs register\` and approve it in a browser.`,
  );
}

const defaultDeps: ForumDeps = {
  fetchImpl: (...args) => fetch(...args),
  readApiKey: readApiKeyFromDisk,
};

/**
 * Reject over-long or plural-voiced fields before anything reaches the forum.
 * Throwing (rather than silently trimming) is the point: the agent sees the
 * budget it broke and rewrites.
 */
export function validateSdkBugReport(input: SdkBugReportInput): void {
  const fields: [keyof typeof WORD_BUDGETS, string][] = [
    ["title", input.title],
    ["description", input.description],
    ["reproduction", input.reproduction],
    ["expected", input.expected],
  ];

  for (const [name, value] of fields) {
    if (!value || value.trim().length === 0) {
      throw new Error(`${name} is required`);
    }
    const words = countWords(value);
    if (words > WORD_BUDGETS[name]) {
      throw new Error(
        `${name} is ${words} words; the budget is ${WORD_BUDGETS[name]}. Cut it, do not reword.`,
      );
    }
  }

  const plural = fields
    .map(([, value]) => value)
    .join("\n")
    .match(/\b(we|our|ours|us)\b/i);
  if (plural) {
    throw new Error(
      `Write in first person singular; found "${plural[0]}". These post under one person's name.`,
    );
  }
}

/** Body for a new topic, matching the category's form-template field order. */
export function composeTopicBody(input: SdkBugReportInput): string {
  const sections = [
    "Where does the bug appear (feature/product)?",
    PRODUCT_AREA,
    "Describe the Bug",
    input.description.trim(),
    "Steps to Reproduce",
    input.reproduction.trim(),
    "Expected Behavior",
    input.expected.trim(),
  ];
  if (input.versionInfo?.trim()) {
    sections.push("Version info", input.versionInfo.trim());
  }
  return sections.join("\n\n");
}

/** Body for a reply — no template headers, just the substance. */
export function composeReplyBody(input: SdkBugReportInput): string {
  const parts = [input.description.trim(), input.reproduction.trim()];
  if (input.expected.trim()) parts.push(input.expected.trim());
  if (input.versionInfo?.trim()) parts.push(input.versionInfo.trim());
  return parts.join("\n\n");
}

async function forumJson(
  path: string,
  init: { method?: string; body?: unknown; apiKey?: string },
  deps: ForumDeps,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.apiKey) headers["User-Api-Key"] = init.apiKey;

  const res = await deps.fetchImpl(`${FORUM_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

/** Topics plausibly covering the same bug, most relevant first. */
export async function searchExistingReports(
  query: string,
  deps: ForumDeps = defaultDeps,
  limit = 5,
): Promise<ForumTopicMatch[]> {
  const { json } = await forumJson(
    `/search.json?q=${encodeURIComponent(query)}`,
    {},
    deps,
  );
  const topics = Array.isArray(json.topics)
    ? (json.topics as Record<string, unknown>[])
    : [];
  return topics.slice(0, limit).map((topic) => ({
    id: Number(topic.id),
    title: String(topic.title),
    createdAt: String(topic.created_at ?? "").slice(0, 10),
    url: `${FORUM_BASE}/t/${topic.id}`,
  }));
}

export async function fileSdkBugReport(
  input: SdkBugReportInput,
  deps: ForumDeps = defaultDeps,
): Promise<FileSdkBugResult> {
  validateSdkBugReport(input);

  if (input.replyToTopicId !== undefined) {
    const { status, json } = await forumJson(
      "/posts.json",
      {
        method: "POST",
        apiKey: deps.readApiKey(),
        body: { topic_id: input.replyToTopicId, raw: composeReplyBody(input) },
      },
      deps,
    );
    if (status !== 200) {
      throw new Error(
        `Forum reply failed (${status}): ${JSON.stringify(json).slice(0, 300)}`,
      );
    }
    return {
      status: "replied",
      topicId: Number(json.topic_id),
      url: `${FORUM_BASE}/t/${json.topic_slug}/${json.topic_id}/${json.post_number}`,
    };
  }

  if (!input.unrelatedToExisting) {
    const candidates = await searchExistingReports(input.title, deps);
    if (candidates.length > 0) {
      return { status: "duplicates_found", candidates };
    }
  }

  const { status, json } = await forumJson(
    "/posts.json",
    {
      method: "POST",
      apiKey: deps.readApiKey(),
      body: {
        title: input.title,
        category: BUG_REPORTS_CATEGORY,
        tags: [SDK_TAG],
        raw: composeTopicBody(input),
      },
    },
    deps,
  );
  if (status !== 200) {
    throw new Error(
      `Forum post failed (${status}): ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return {
    status: "created",
    topicId: Number(json.topic_id),
    url: `${FORUM_BASE}/t/${json.topic_slug}/${json.topic_id}`,
  };
}

/**
 * The agent-facing tool. Returns `duplicates_found` rather than posting when
 * the search turns anything up, so the model must consciously choose between
 * replying to an existing report and asserting the matches are unrelated.
 */
export function createSdkBugReportTools(
  deps: ForumDeps = defaultDeps,
): Record<string, SDKCustomTool> {
  return {
    file_cursor_sdk_bug: {
      description:
        "File a bug in @cursor/sdk (the agent SDK this app embeds) on forum.cursor.com under Jared's account. SDK bugs only — not the Cursor IDE, CLI, or cloud agents, and never feature requests or questions. Searches for existing reports first and refuses to open a duplicate. Fields are word-budgeted and must be first person singular.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: `One specific line naming the failure, max ${WORD_BUDGETS.title} words.`,
          },
          description: {
            type: "string",
            description: `Symptom and root cause if known, max ${WORD_BUDGETS.description} words. No preamble.`,
          },
          reproduction: {
            type: "string",
            description: `Concrete steps, or the evidence that stands in for them, max ${WORD_BUDGETS.reproduction} words.`,
          },
          expected: {
            type: "string",
            description: `What should happen instead, max ${WORD_BUDGETS.expected} words.`,
          },
          versionInfo: {
            type: "string",
            description: "SDK version, Node version, OS, model — whatever pins it down.",
          },
          replyToTopicId: {
            type: "number",
            description:
              "Reply to this existing topic instead of opening a new one. Use whenever a prior report covers the same bug.",
          },
          unrelatedToExisting: {
            type: "boolean",
            description:
              "Set only after reviewing search hits and confirming none describe this bug. Forces a new topic.",
          },
        },
        required: ["title", "description", "reproduction", "expected"],
      },
      execute: async (args) =>
        fileSdkBugReport(args as unknown as SdkBugReportInput, deps),
    },
  };
}
