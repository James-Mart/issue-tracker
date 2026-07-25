import { join } from "path";
import type { ModelSelection } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import {
  agentSdk,
  type AgentHandle,
  type AgentSdk,
  type AgentStreamEvent,
} from "./agent-sdk.js";
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

const PROBE_PROMPT =
  "This is a wiring probe, not real work. Do not read files, run commands, " +
  "or start the checks described above. Reply with the single word ok.";

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

type ToolCallMessage = Extract<
  Extract<AgentStreamEvent, { kind: "message" }>["message"],
  { type: "tool_call" }
>;

/** The tool name the SDK reports for a Cursor Task call. */
const TASK_TOOL_NAME = "task";

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

      const run = await agent.send(
        `Call the Task tool exactly once, with subagent_type "${ROLE}", ` +
          'description "plan-polish check", and prompt ' +
          `${JSON.stringify(CHECK_STUB_PROMPT)}. ` +
          "Pass no model argument on that call. " +
          "Then reply with the single word done.",
      );

      const toolCalls: ToolCallMessage[] = [];
      for await (const event of run) {
        if (event.kind === "message" && event.message.type === "tool_call") {
          toolCalls.push(event.message);
        }
      }
      await run.wait();

      expect(toolCalls.map((call) => call.name)).not.toContain("delegate");

      const completed = toolCalls.filter(
        (call) => call.name === TASK_TOOL_NAME && call.status === "completed",
      );
      expect(completed).toHaveLength(1);

      const result = completed[0]!.result;
      expect(extractTaskHints(result).resultAgentId).toBeDefined();

      const findings = taskReplyText(result).trim();
      expect(findings).not.toBe("");
      expect(JSON.parse(findings)).toEqual([]);
    },
    LIVE_TIMEOUT_MS,
  );
});
