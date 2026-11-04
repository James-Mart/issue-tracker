import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dir,
  env,
  issueJsonField,
  nextAt as at,
  useCliTestFixtures,
  writeIssue,
} from "../cli.test-helpers.js";
import type { AgentHandle, AgentRun, CreateAgentOptions } from "../server/services/agent-sdk.js";
import {
  OUTLINE_PLANNING_GROK_MODEL,
  OUTLINE_PLANNING_OPUS_MODEL,
} from "../src/features/issues/lib/outline-planning-launch.js";

useCliTestFixtures();

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const OUTLINE_BODY = "# Background\n\nWhy.\n\n# Implementation\n\n## Area\n\nWhat.\n";

const sourceOutlineOf = (id: string) => issueJsonField(id, "sourceOutline");

function tracked() {
  return { archived: false, needsAttention: false, attentionReason: null, createdAt: at(), updatedAt: at() };
}

function epic(id: string, order: number, extra: Record<string, unknown> = {}) {
  return { kind: "epic", title: id, partOf: "p", blockedBy: [], order, ...tracked(), ...extra };
}

function story(id: string, partOf: string, order: number, extra: Record<string, unknown> = {}) {
  return { kind: "story", title: id, partOf, order, merged: false, reviewedTasks: [], ...tracked(), ...extra };
}

function task(id: string, partOf: string, extra: Record<string, unknown> = {}) {
  return { kind: "task", title: id, partOf, order: 0, status: "todo", ...tracked(), ...extra };
}

/**
 * Idea `idea-a` (Opus stakeholder) planned Epic `epic-a` and Story `story-b`;
 * `story-c` has no Idea. Merged, archived, and already-linked roots are the
 * ones the backfill leaves alone.
 */
function writeStore(): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    trunk: "main",
    workspace: dir,
    createdAt: at(),
    updatedAt: at(),
  });
  writeIssue("idea-a", {
    kind: "idea",
    title: "Idea A",
    partOf: "p",
    order: 0,
    stakeholder: "claude-opus-5-thinking-high",
    archived: true,
    createdAt: at(),
    updatedAt: at(),
  });
  writeIssue("epic-a", epic("epic-a", 1, { sourceIdea: "idea-a" }));
  writeIssue("a-open", story("a-open", "epic-a", 0));
  writeIssue("a-open-t", task("a-open-t", "a-open"));
  writeIssue("a-merged", story("a-merged", "epic-a", 1, { merged: true }));
  writeIssue("a-merged-t", task("a-merged-t", "a-merged", { status: "done" }));
  writeIssue("a-stacked", story("a-stacked", "epic-a", 0, { stackedOn: "a-merged" }));
  writeIssue("story-b", story("story-b", "p", 2, { sourceIdea: "idea-a" }));
  writeIssue("b-t", task("b-t", "story-b"));
  writeIssue("story-c", story("story-c", "p", 3));
  writeIssue("story-merged", story("story-merged", "p", 4, { merged: true }));
  writeIssue("epic-archived", epic("epic-archived", 5, { archived: true }));
  writeIssue("outline-old", {
    kind: "outline",
    title: "Old",
    partOf: "p",
    order: 0,
    bodyVersion: 1,
    archived: false,
    createdAt: at(),
    updatedAt: at(),
  });
  writeIssue("epic-linked", epic("epic-linked", 6, { sourceOutline: { outline: "outline-old", version: 1 } }));
}

/** Planner fake: writes `body` to the prompt's body file and finishes. */
function plannerSdk(body: string) {
  const created: CreateAgentOptions[] = [];
  const messages: string[] = [];
  const sdk = {
    async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
      created.push(options);
      return {
        agentId: `agent-${created.length}`,
        async send(message) {
          const text = typeof message === "string" ? message : message.text;
          messages.push(text);
          const bodyFile = text.match(/Body file: `([^`]+)`/)?.[1];
          if (!bodyFile) throw new Error(`no body file in planner prompt: ${text}`);
          writeFileSync(bodyFile, body);
          return { id: "run", wait: async () => ({ id: "run", status: "finished" }) } as unknown as AgentRun;
        },
        async cancel() {},
        async [Symbol.asyncDispose]() {},
      };
    },
  };
  return { sdk, created, messages };
}

async function loadBackfill() {
  const backfill = await import("./outline-backfill.js");
  const { list } = await import("../server/services/issues.js");
  const outlines = () => list().issues.filter((issue) => issue.kind === "outline" && issue.id !== "outline-old");
  return { ...backfill, outlines };
}

describe("outline backfill", () => {
  it("saves each planner draft as version 1 and stamps the unmerged trees", async () => {
    writeStore();
    const { runOutlineBackfill, outlines } = await loadBackfill();
    const planner = plannerSdk(OUTLINE_BODY);
    const log: string[] = [];

    await runOutlineBackfill({ dryRun: false, sdk: planner.sdk, log: (line) => log.push(line) });

    expect(planner.created.map((options) => options.model)).toEqual([
      OUTLINE_PLANNING_OPUS_MODEL,
      OUTLINE_PLANNING_GROK_MODEL,
    ]);
    expect(planner.created.every((options) => options.cwd === dir)).toBe(true);
    expect(planner.messages[0]).toContain("Source Idea: `idea-a`. Roots: `epic-a`, `story-b`.");
    expect(planner.messages[1]).toContain("Source Idea: `none`. Roots: `story-c`.");

    const [fromIdea, fromStory] = outlines();
    expect(fromIdea).toMatchObject({ title: "Idea A", sourceIdea: "idea-a", bodyVersion: 1 });
    expect(fromStory).toMatchObject({ title: "story-c", bodyVersion: 1 });
    expect(fromStory).not.toHaveProperty("sourceIdea");
    expect(readFileSync(join(dir, fromIdea!.id, "description.md"), "utf8")).toBe(OUTLINE_BODY);
    expect(log).toEqual([`${fromIdea!.id}: epic-a story-b`, `${fromStory!.id}: story-c`]);

    const ideaStamp = { outline: fromIdea!.id, version: 1 };
    for (const id of ["epic-a", "a-open", "a-open-t", "a-stacked", "story-b", "b-t"]) {
      expect(sourceOutlineOf(id), id).toEqual(ideaStamp);
    }
    expect(sourceOutlineOf("story-c")).toEqual({ outline: fromStory!.id, version: 1 });
    for (const id of ["a-merged", "a-merged-t", "story-merged", "epic-archived"]) {
      expect(sourceOutlineOf(id), id).toBeUndefined();
    }
    expect(sourceOutlineOf("epic-linked")).toEqual({ outline: "outline-old", version: 1 });
  });
});
