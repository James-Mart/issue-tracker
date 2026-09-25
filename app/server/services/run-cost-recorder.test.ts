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
  previousSettledCumulative,
  type GetUsageFn,
  type RunCostRecorderClock,
} from "./run-cost-recorder.js";

const AT = "2026-01-01T00:00:00.000Z";
const USAGE = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
};

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

async function appendRunUsage(
  conversationId: string,
  runId: string,
  agentId: string,
  at: string,
  parentCallId?: string,
) {
  const { appendEvent } = await loadConversations();
  await appendEvent(conversationId, {
    type: "run_usage",
    runId,
    agentId,
    usage: USAGE,
    ...(parentCallId !== undefined ? { parentCallId } : {}),
  });
  // Overwrite stamped `at` so boot resume can target a known timestamp.
  const events = transcriptOf(conversationId);
  const last = events[events.length - 1]!;
  writeFileSync(
    join(issuesRoot, "conversations", conversationId, "transcript.jsonl"),
    `${events
      .slice(0, -1)
      .map((event) => JSON.stringify(event))
      .concat(JSON.stringify({ ...last, at }))
      .join("\n")}\n`,
  );
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

async function advanceThroughPollWindow() {
  for (let i = 0; i < RUN_COST_POLL_OFFSETS_MS.length; i++) {
    const offset = RUN_COST_POLL_OFFSETS_MS[i]!;
    const prev = i === 0 ? 0 : RUN_COST_POLL_OFFSETS_MS[i - 1]!;
    await vi.advanceTimersByTimeAsync(offset - prev);
  }
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
  it("settles on two consecutive equal reads", async () => {
    getUsage
      .mockResolvedValueOnce({ cost: { rawCostCents: 12, chargedCents: 0 } })
      .mockResolvedValueOnce({ cost: { rawCostCents: 12, chargedCents: 0 } });

    const meta = await createTestConversation("Settle");
    const recorder = makeRecorder();
    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-1",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceToFirstPoll();
    await advanceToSecondPoll();

    const costs = runCostEvents(meta.id);
    expect(costs).toEqual([
      expect.objectContaining({
        type: "run_cost",
        runId: "run-1",
        agentId: "agent-1",
        status: "settled",
        cumulative: { rawCostCents: 12, chargedCents: 0 },
        cost: { rawCostCents: 12, chargedCents: 0 },
      }),
    ]);
    expect(getUsage).toHaveBeenCalledTimes(2);
  });

  it("records unavailable after the last read", async () => {
    getUsage.mockImplementation(async () => ({
      cost: { rawCostCents: getUsage.mock.calls.length, chargedCents: 0 },
    }));

    const meta = await createTestConversation("Unavailable");
    const recorder = makeRecorder();
    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-1",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceThroughPollWindow();

    expect(runCostEvents(meta.id)).toEqual([
      expect.objectContaining({
        type: "run_cost",
        runId: "run-1",
        status: "unavailable",
      }),
    ]);
    expect(getUsage).toHaveBeenCalledTimes(RUN_COST_POLL_OFFSETS_MS.length);
  });

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

  it("polls one agent's runs in order", async () => {
    getUsage.mockImplementation(async () => ({
      cost: { rawCostCents: getUsage.mock.calls.length, chargedCents: 0 },
    }));

    const meta = await createTestConversation("Ordering");
    const recorder = makeRecorder();
    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-1",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceThroughPollWindow();
    expect(runCostEvents(meta.id)).toEqual([
      expect.objectContaining({ runId: "run-1", status: "unavailable" }),
    ]);
    expect(getUsage).toHaveBeenCalledTimes(RUN_COST_POLL_OFFSETS_MS.length);

    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-2",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceThroughPollWindow();
    expect(runCostEvents(meta.id).map((event) => event.runId)).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("at boot resumes the latest run and marks earlier gaps unavailable", async () => {
    const meta = await createTestConversation("Boot");
    await appendRunUsage(meta.id, "run-1", "agent-1", AT);
    await appendRunUsage(meta.id, "run-2", "agent-1", AT);

    getUsage
      .mockResolvedValueOnce({ cost: { rawCostCents: 9, chargedCents: 0 } })
      .mockResolvedValueOnce({ cost: { rawCostCents: 9, chargedCents: 0 } });

    const recorder = makeRecorder();
    await recorder.resumeAtBoot();

    expect(runCostEvents(meta.id)).toEqual([
      expect.objectContaining({ runId: "run-1", status: "unavailable" }),
    ]);
    expect(getUsage).toHaveBeenCalledTimes(0);

    await advanceToFirstPoll();
    await advanceToSecondPoll();

    expect(runCostEvents(meta.id)).toEqual([
      expect.objectContaining({ runId: "run-1", status: "unavailable" }),
      expect.objectContaining({
        runId: "run-2",
        status: "settled",
        cumulative: { rawCostCents: 9, chargedCents: 0 },
      }),
    ]);
  });

  it("logs getUsage errors and treats them as unsettled reads", async () => {
    getUsage
      .mockRejectedValueOnce(new Error("billing unavailable"))
      .mockResolvedValueOnce({ cost: { rawCostCents: 3, chargedCents: 0 } })
      .mockResolvedValueOnce({ cost: { rawCostCents: 3, chargedCents: 0 } });

    const meta = await createTestConversation("Errors");
    const recorder = makeRecorder();
    recorder.onRunUsage({
      conversationId: meta.id,
      runId: "run-1",
      agentId: "agent-1",
      endedAt: Date.now(),
    });

    await advanceToFirstPoll();
    await advanceToSecondPoll();
    await vi.advanceTimersByTimeAsync(
      RUN_COST_POLL_OFFSETS_MS[2]! - RUN_COST_POLL_OFFSETS_MS[1]!,
    );

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("getUsage failed"),
      expect.any(Error),
    );
    expect(runCostEvents(meta.id)).toEqual([
      expect.objectContaining({
        runId: "run-1",
        status: "settled",
        cumulative: { rawCostCents: 3, chargedCents: 0 },
      }),
    ]);
  });
});

describe("previousSettledCumulative", () => {
  it("returns the latest settled cumulative for the agent", () => {
    const transcript = [
      {
        type: "run_cost",
        runId: "a",
        agentId: "agent-1",
        status: "settled",
        cumulative: { rawCostCents: 1, chargedCents: 0 },
        cost: { rawCostCents: 1, chargedCents: 0 },
        at: AT,
      },
      {
        type: "run_cost",
        runId: "b",
        agentId: "agent-2",
        status: "settled",
        cumulative: { rawCostCents: 99, chargedCents: 0 },
        cost: { rawCostCents: 99, chargedCents: 0 },
        at: AT,
      },
      {
        type: "run_cost",
        runId: "c",
        agentId: "agent-1",
        status: "unavailable",
        at: AT,
      },
      {
        type: "run_cost",
        runId: "d",
        agentId: "agent-1",
        status: "settled",
        cumulative: { rawCostCents: 4, chargedCents: 1 },
        cost: { rawCostCents: 3, chargedCents: 1 },
        at: AT,
      },
    ] as TranscriptEvent[];

    expect(previousSettledCumulative(transcript, "agent-1")).toEqual({
      rawCostCents: 4,
      chargedCents: 1,
    });
  });
});
