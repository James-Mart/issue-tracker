import { join } from "path";
import type { ModelSelection } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import {
  agentSdk,
  type AgentHandle,
  type AgentRun,
  type AgentSdk,
  type AgentStreamEvent,
} from "./agent-sdk.js";
import {
  createConversation,
  deleteConversation,
  readConversation,
} from "./conversations.js";
import { createDelegateCustomTools } from "./delegate-tool.js";
import { extractTaskHints } from "./event-pipeline.js";
import { resolveModelSelection } from "./model-selection.js";
import { loadRoleModelPin } from "./role-bodies.js";

// Live SDK suite, on the same lane as `agent-sdk.live.test.ts`: authored and
// preserved, but excluded from the default `npm test` (which must never
// contact the SDK/network or spend tokens). Enabled only via
// `npm run test:live`, which sets `CURSOR_SDK_LIVE` and requires a real
// `CURSOR_API_KEY`.

/** A real turn outlives vitest's default per-test timeout many times over. */
const LIVE_TIMEOUT_MS = 300_000;

/** Room for an assertion that spends two full turns instead of one. */
const TWO_TURN_TIMEOUT_MS = LIVE_TIMEOUT_MS * 2;

const STORE_DIR = join(process.cwd(), ".agent-state-test");

/**
 * The selection a parent conversation runs on — a base catalog id, and one no
 * role pins to. A nested run reporting this would be the conversation's own
 * model showing through instead of the role's pin.
 */
const PARENT_CONVERSATION_MODEL: ModelSelection = { id: "claude-sonnet-4-5" };

/**
 * A real plugin role, read-only and pinned to a slug whose selection carries
 * parameter fields — so matching it takes more than landing on the base model.
 */
const ROLE = "issue-tracker-plan-dependency-order";

/**
 * The role the depth-2 chain ends on — a second read-only plugin role, pinned
 * to a slug that maps to a different selection than {@link ROLE}'s (and than
 * {@link PARENT_CONVERSATION_MODEL}), so neither nested run could pass the
 * other's model assertion.
 */
const NESTED_ROLE = "issue-tracker-research";

const PROBE_PROMPT =
  "This is a wiring probe, not real work. Do not read files, run commands, " +
  "or start the checks described above. Reply with the single word ok.";

/** {@link PROBE_PROMPT}'s guard, worded for a research role. */
const NESTED_PROBE_PROMPT =
  "This is a wiring probe, not real work. Do not read files, run commands, " +
  "or research the question described above. Reply with the single word ok.";

/**
 * What turns {@link ROLE} into the middle of a depth-2 chain: it delegates
 * once itself, through the `delegate` tool its own nested run was handed.
 */
const DELEGATING_STUB_PROMPT =
  "This is a wiring probe, not real work. Do not read files, run commands, " +
  "or start the checks described above. Call the delegate tool exactly once, " +
  `with role "${NESTED_ROLE}" and prompt ` +
  `${JSON.stringify(NESTED_PROBE_PROMPT)}. ` +
  "Then reply with the single word ok.";

/** Stands in for the conversation root's `delegate` tool call id. */
const ROOT_CALL_ID = "call-depth-2-root";

/**
 * What the migrated plan-polish coordinator hands a check role: the work-root
 * context line and the findings return line from the skill's spawn stubs,
 * closed with the same wiring-probe guard {@link PROBE_PROMPT} uses — so the
 * check answers in its contract shape without reviewing a tree for real.
 */
const CHECK_STUB_PROMPT =
  "Work root: `delegation-bridge` (App-hosted delegation bridge). " +
  "Return only a JSON findings array per " +
  "`agents/_issue-tracker-plan-polish-check-base.md` (detection-only — no " +
  "fixes; no prose wrapper). " +
  "This is a wiring probe, not real work: do not read files or run " +
  "commands, and return the empty array [] as your entire reply.";

/**
 * A migrated work role, and the one the work skill re-enters rather than
 * respawning: the code-quality validator is spawned once per Task and resumed
 * on every later `qa` beat.
 */
const WORK_ROLE = "issue-tracker-code-quality-validator";

/**
 * The issue id the work stubs below carry. Deliberately not a tracked issue —
 * unlike the read-only check role, code-quality writes `qa` on entry, and a
 * wiring probe must not be able to move a real Task's gate even if a run
 * ignores {@link WORK_PROBE_GUARD}.
 */
const PROBE_ISSUE_ID = "live-probe-no-such-issue";

/** {@link PROBE_PROMPT}'s guard, worded for a role that writes the tracker. */
const WORK_PROBE_GUARD =
  "This is a wiring probe, not real work: do not read files, run commands " +
  "(including `issue`), or set any tracker field, and reply with the single " +
  "word ok.";

/** The work skill's code-quality spawn stub, over its Issue context line. */
const CODE_QUALITY_STUB_PROMPT =
  `Work root: \`delegation-bridge\`. Issue: \`${PROBE_ISSUE_ID}\` ` +
  "(live wiring probe). Mode: review. Comment role: " +
  "`code-quality-validator`. " +
  WORK_PROBE_GUARD;

/** The work skill's code-quality resume stub — the re-entry beat. */
const CODE_QUALITY_RESUME_STUB_PROMPT =
  `Work root: \`delegation-bridge\`. Issue: \`${PROBE_ISSUE_ID}\` ` +
  "(live wiring probe). Mode: resume. Comment role: " +
  "`code-quality-validator`. Verify that previously requested changes were " +
  "fixed. " +
  WORK_PROBE_GUARD;

type ToolCallMessage = Extract<
  Extract<AgentStreamEvent, { kind: "message" }>["message"],
  { type: "tool_call" }
>;

type SubagentUpdateEvent = Extract<
  TranscriptEvent,
  { type: "subagent_update" }
>;

/** The tool name the SDK reports for a Cursor Task call. */
const TASK_TOOL_NAME = "task";

/** The `subagent_update` events a conversation recorded, in transcript order. */
function recordedNestedEvents(conversationId: string): SubagentUpdateEvent[] {
  return readConversation(conversationId).transcript.filter(
    (event): event is SubagentUpdateEvent =>
      event.type === "subagent_update",
  );
}

/** Every `tool_call` message one send reported, drained to completion. */
async function toolCallsFrom(run: AgentRun): Promise<ToolCallMessage[]> {
  const toolCalls: ToolCallMessage[] = [];
  for await (const event of run) {
    if (event.kind === "message" && event.message.type === "tool_call") {
      toolCalls.push(event.message);
    }
  }
  await run.wait();
  return toolCalls;
}

/**
 * The one completed Task call a send made — and, on the way, the IDE-channel
 * claim itself: no `delegate` was attempted, and the delegation went out over
 * Task exactly once.
 */
function soleCompletedTaskCall(toolCalls: ToolCallMessage[]): ToolCallMessage {
  expect(toolCalls.map((call) => call.name)).not.toContain("delegate");
  const completed = toolCalls.filter(
    (call) => call.name === TASK_TOOL_NAME && call.status === "completed",
  );
  expect(completed).toHaveLength(1);
  return completed[0]!;
}

/**
 * What the delegated check replied, as it arrives on the Task call's result:
 * the SDK hands back the nested run's conversation steps, and the findings
 * are its closing assistant message.
 */
function taskReplyText(result: unknown): string {
  const steps =
    (result as { value?: { conversationSteps?: unknown[] } } | null)?.value
      ?.conversationSteps ?? [];
  let text = "";
  for (const step of steps) {
    const message = (step as { assistantMessage?: { text?: unknown } })
      .assistantMessage;
    if (typeof message?.text === "string") text = message.text;
  }
  return text;
}

/**
 * Wrap an {@link AgentSdk} so every run started through it records the model
 * the SDK reported for that run. The recorded value is `AgentRun.model` — the
 * SDK's own `Run.model`, resolved against the live model catalog — never the
 * selection the app asked for.
 */
function recordRunModels(inner: AgentSdk): {
  sdk: AgentSdk;
  runModels: (ModelSelection | undefined)[];
} {
  const runModels: (ModelSelection | undefined)[] = [];

  function record(handle: AgentHandle): AgentHandle {
    return {
      agentId: handle.agentId,
      async send(prompt, options) {
        const run = await handle.send(prompt, options);
        runModels.push(run.model);
        return run;
      },
      cancel: () => handle.cancel(),
      [Symbol.asyncDispose]: () => handle[Symbol.asyncDispose](),
    };
  }

  return {
    runModels,
    sdk: {
      listModels: () => inner.listModels(),
      createAgent: async (options) => record(await inner.createAgent(options)),
      resumeAgent: async (agentId, storeDir, options) =>
        record(await inner.resumeAgent(agentId, storeDir, options)),
    },
  };
}

describe.skipIf(!process.env.CURSOR_SDK_LIVE)("delegate tool (live)", () => {
  // A mapping unit test proves the table; only a live delegation proves a
  // nested run is what the table says it is.
  it(
    "runs the delegated role on the selection its pin maps to",
    async () => {
      const { sdk, runModels } = recordRunModels(agentSdk);
      const customTools = createDelegateCustomTools({
        sdk,
        cwd: process.cwd(),
        storeDir: STORE_DIR,
      });

      await customTools.delegate!.execute(
        { role: ROLE, prompt: PROBE_PROMPT },
        {},
      );

      expect(runModels).toHaveLength(1);
      const [nestedModel] = runModels;
      expect(nestedModel).toBeDefined();
      expect(nestedModel).not.toEqual(PARENT_CONVERSATION_MODEL);
      expect(nestedModel).toEqual(resolveModelSelection(loadRoleModelPin(ROLE)));
    },
    LIVE_TIMEOUT_MS,
  );

  // Depth 2 is the chain the bridge exists to carry, so it is measured rather
  // than extrapolated from depth 1: the innermost run is started by a nested
  // run's own tools, which is where a role's pin could collapse onto its
  // delegator's model and where parentage could be lost. Recording the
  // parentage needs a real conversation — the `subagent_update` frames are
  // persisted against one.
  it(
    "runs a depth-2 chain on each role's pin and records the nested parentage",
    async () => {
      const conversation = await createConversation({
        title: "Depth-2 delegation probe",
        projectId: "issue-tracker",
        model: PARENT_CONVERSATION_MODEL.id,
      });

      try {
        const { sdk, runModels } = recordRunModels(agentSdk);
        const customTools = createDelegateCustomTools({
          sdk,
          cwd: process.cwd(),
          storeDir: STORE_DIR,
          conversationId: conversation.id,
        });

        await customTools.delegate!.execute(
          { role: ROLE, prompt: DELEGATING_STUB_PROMPT },
          { toolCallId: ROOT_CALL_ID },
        );

        // Sends resolve in chain order: the intermediate run is already
        // streaming when its own `delegate` call starts the innermost one.
        expect(runModels).toHaveLength(2);
        const [intermediateModel, innermostModel] = runModels;
        expect(intermediateModel).toEqual(
          resolveModelSelection(loadRoleModelPin(ROLE)),
        );
        expect(innermostModel).toEqual(
          resolveModelSelection(loadRoleModelPin(NESTED_ROLE)),
        );
        expect(innermostModel).not.toEqual(intermediateModel);

        // The intermediate run is the one keyed to the root's call id; the
        // innermost hangs off the SDK call id of the intermediate's own
        // `delegate` call.
        const nested = recordedNestedEvents(conversation.id);
        const intermediateEvents = nested.filter(
          (event) => event.parentCallId === ROOT_CALL_ID,
        );
        const innermostEvents = nested.filter(
          (event) => event.parentCallId !== ROOT_CALL_ID,
        );
        expect(intermediateEvents.length).toBeGreaterThan(0);
        expect(innermostEvents.length).toBeGreaterThan(0);

        const intermediateDelegationId = intermediateEvents[0]!.delegationId;
        expect(intermediateDelegationId).toEqual(expect.any(String));
        expect(
          intermediateEvents.every(
            (event) => event.parentDelegationId === undefined,
          ),
        ).toBe(true);
        expect(
          innermostEvents.every(
            (event) => event.parentDelegationId === intermediateDelegationId,
          ),
        ).toBe(true);
        expect(innermostEvents[0]!.delegationId).not.toBe(
          intermediateDelegationId,
        );
      } finally {
        await deleteConversation(conversation.id);
      }
    },
    LIVE_TIMEOUT_MS,
  );

  // The IDE counterpart to the assertion above. `lint:spawns` proves the
  // migrated stubs have the right shape; only a live run proves an agent on
  // that surface still gets its check done. Omitting `customTools` is the IDE
  // condition: the channel-detection probe finds no `delegate`, while the
  // plugin `agents` map keeps the check roles on the Task tool. The evidence
  // is the parent's own stream — on this channel no bridge records anything.
  it(
    "delegates a migrated plan-polish check over Task when no delegate tool exists",
    async () => {
      await using agent = await agentSdk.createAgent({
        cwd: process.cwd(),
        model: PARENT_CONVERSATION_MODEL,
        storeDir: STORE_DIR,
        agents: loadPluginAgentDefinitions(),
      });

      const toolCalls = await toolCallsFrom(
        await agent.send(
          `Call the Task tool exactly once, with subagent_type "${ROLE}", ` +
            'description "plan-polish check", and prompt ' +
            `${JSON.stringify(CHECK_STUB_PROMPT)}. ` +
            "Pass no model argument on that call. " +
            "Then reply with the single word done.",
        ),
      );

      const result = soleCompletedTaskCall(toolCalls).result;
      expect(extractTaskHints(result).resultAgentId).toBeDefined();

      const findings = taskReplyText(result).trim();
      expect(findings).not.toBe("");
      expect(JSON.parse(findings)).toEqual([]);
    },
    LIVE_TIMEOUT_MS,
  );

  // The same IDE claim, re-proved against the work vocabulary: work holds ten
  // of the call sites and is the skill that runs this plan, so it is measured
  // rather than inherited from the plan-polish assertion above. Its re-entry
  // beat is the part no earlier assertion reaches — a coordinator that resumes
  // code-quality on `qa` has to land back inside the agent it already has.
  it(
    "re-enters a migrated work delegation over Task when no delegate tool exists",
    async () => {
      await using agent = await agentSdk.createAgent({
        cwd: process.cwd(),
        model: PARENT_CONVERSATION_MODEL,
        storeDir: STORE_DIR,
        agents: loadPluginAgentDefinitions(),
      });

      const spawned = soleCompletedTaskCall(
        await toolCallsFrom(
          await agent.send(
            "Call the Task tool exactly once, with subagent_type " +
              `"${WORK_ROLE}", description "code quality", and prompt ` +
              `${JSON.stringify(CODE_QUALITY_STUB_PROMPT)}. ` +
              "Pass no model argument on that call. " +
              "Then reply with the single word done.",
          ),
        ),
      );
      const spawnedAgentId = extractTaskHints(spawned.result).resultAgentId;
      expect(spawnedAgentId).toBeDefined();

      const resumed = soleCompletedTaskCall(
        await toolCallsFrom(
          await agent.send(
            "Call the Task tool exactly once, with subagent_type " +
              `"${WORK_ROLE}", resume "${spawnedAgentId}", description ` +
              '"code quality (resume)", and prompt ' +
              `${JSON.stringify(CODE_QUALITY_RESUME_STUB_PROMPT)}. ` +
              "Pass no model argument on that call. " +
              "Then reply with the single word done.",
          ),
        ),
      );

      // A resume that missed would complete too — as a second subagent, under
      // its own id. Equality is what says the re-entry landed on the first.
      expect(extractTaskHints(resumed.result).resultAgentId).toBe(
        spawnedAgentId,
      );
    },
    TWO_TURN_TIMEOUT_MS,
  );
});
