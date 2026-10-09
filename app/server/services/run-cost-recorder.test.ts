import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import {
  RUN_COST_POLL_OFFSETS_MS,
  createRunCostRecorder,
  type GetUsageFn,
  type RunCostRecorderClock,
} from "./run-cost-recorder.js";

const AT = "2026-01-01T00:00:00.000Z";

let issuesRoot: string;
let issuesDir: string;
let getUsage: Mock<GetUsageFn>;
let logError: Mock<(message: string, err: unknown) => void>;
let clock: RunCostRecorderClock;

function seedPlatformIssue(): void {
  mkdirSync(join(issuesDir, "platform"), { recursive: true });
  writeFileSync(
    join(issuesDir, "platform", "issue.json"),
    JSON.stringify({
      id: "platform",
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
}

async function loadConversations() {
  const { refreshStorePathsFromEnv } = await import("../config.js");
  refreshStorePathsFromEnv();
  return import("./conversations.js");
}

function transcriptOf(conversationId: string): TranscriptEvent[] {
  const path = join(
    issuesRoot,
    "conversations",
    conversationId,
    "transcript.jsonl",
  );
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TranscriptEvent);
}

function runCostEvents(conversationId: string) {
  return transcriptOf(conversationId).filter(
    (event): event is Extract<TranscriptEvent, { type: "run_cost" }> =>
      event.type === "run_cost",
  );
}

async function createTestConversation(title: string) {
  const { createConversation } = await loadConversations();
  return createConversation({
    title,
    projectId: "platform",
    model: "composer-2.5",
  });
}

function makeRecorder() {
  return createRunCostRecorder({ getUsage, clock, logError });
}

async function advanceToFirstPoll() {
  await vi.advanceTimersByTimeAsync(RUN_COST_POLL_OFFSETS_MS[0]);
}

async function advanceToSecondPoll() {
  await vi.advanceTimersByTimeAsync(
    RUN_COST_POLL_OFFSETS_MS[1] - RUN_COST_POLL_OFFSETS_MS[0],
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${AT.slice(0, 11)}00:00:00.000Z`));
  issuesRoot = mkdtempSync(join(tmpdir(), "run-cost-recorder-"));
  issuesDir = join(issuesRoot, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedPlatformIssue();
  getUsage = vi.fn();
  logError = vi.fn();
  clock = {
    now: () => Date.now(),
    sleep: async (ms) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(issuesRoot, { recursive: true, force: true });
});

describe("run cost recorder", () => {
  it("stores the difference from the previous settled snapshot", async () => {
    const meta = await createTestConversation("Difference");
    const { appendEvent } = await loadConversations();
    await appendEvent(meta.id, {
      type: "run_cost",
      runId: "run-old",
      agentId: "agent-1",
      status: "settled",
      cumulative: { rawCostCents: 40, chargedCents: 5 },
      cost: { rawCostCents: 40, chargedCents: 5 },
    });

    getUsage
      .mockResolvedValueOnce({ cost: { rawCostCents: 55, chargedCents: 8 } })
      .mockResolvedValueOnce({ cost: { rawCostCents: 55, chargedCents: 8 } });

    const recorder = makeRecorder();
    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-new",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceToFirstPoll();
    await advanceToSecondPoll();

    expect(runCostEvents(meta.id).at(-1)).toMatchObject({
      runId: "run-new",
      status: "settled",
      cumulative: { rawCostCents: 55, chargedCents: 8 },
      cost: { rawCostCents: 15, chargedCents: 3 },
    });
  });
});
