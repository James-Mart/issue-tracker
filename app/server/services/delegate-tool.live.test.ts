import { join } from "path";
import type { ModelSelection } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import { agentSdk, type AgentHandle, type AgentSdk } from "./agent-sdk.js";
import {
  createConversation,
  deleteConversation,
  readConversation,
} from "./conversations.js";
import { createDelegateCustomTools } from "./delegate-tool.js";
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

/** A wiring-probe guard, worded for a research role. */
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
 * A workspace that is not the directory this process was launched from. Every
 * app-hosted delegation runs in its Project's workspace while the server runs
 * out of `app/`, and the SDK files an agent under the workspace it ran in — so
 * a re-entry probe that reuses `process.cwd()` proves nothing about the
 * re-entry the app actually performs.
 */
const PROJECT_WORKSPACE = join(process.cwd(), "..");

/** Carried across the re-entry, so continuity is measured and not assumed. */
const CODE_WORD = "canary-7431";

/** Cheap two-turn re-entry: one thing to remember, then one thing to recall. */
const REMEMBER_PROMPT =
  "This is a wiring probe, not real work. Do not read files, run commands, " +
  `or research the question described above. Remember the code word ${CODE_WORD}. ` +
  "Reply with the single word ok.";

const RECALL_PROMPT =
  "Still the same wiring probe. Do not read files or run commands. Reply " +
  "with the code word you were given earlier and nothing else.";

type SubagentUpdateEvent = Extract<
  TranscriptEvent,
  { type: "subagent_update" }
>;

/** The `subagent_update` events a conversation recorded, in transcript order. */
function recordedNestedEvents(conversationId: string): SubagentUpdateEvent[] {
  return readConversation(conversationId).transcript.filter(
    (event): event is SubagentUpdateEvent =>
      event.type === "subagent_update",
  );
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
      prewarmWorkspace: (cwd) => inner.prewarmWorkspace(cwd),
    },
  };
}

describe.skipIf(!process.env.CURSOR_SDK_LIVE)("delegate tool (live)", () => {
  // Depth 2 is the chain the bridge exists to carry: the innermost run is
  // started by a nested run's own tools, which is where a role's pin could
  // collapse onto its delegator's model and where parentage could be lost.
  // Recording the parentage needs a real conversation — the `subagent_update`
  // frames are persisted against one.
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

  // The beat every relay loop is built on: the auto-plan coordinator answers a
  // grill question by re-entering the planner it already has. Resuming is not
  // symmetric with spawning — the SDK looks a stored agent up under the
  // workspace it ran in — so this runs against a workspace that is not
  // `process.cwd()`, the condition the app is always in.
  it(
    "re-enters a nested agent through the bridge and keeps its context",
    async () => {
      const customTools = createDelegateCustomTools({
        sdk: agentSdk,
        cwd: PROJECT_WORKSPACE,
        storeDir: STORE_DIR,
      });

      const spawned = (await customTools.delegate!.execute(
        { role: NESTED_ROLE, prompt: REMEMBER_PROMPT },
        {},
      )) as { agentId: string; reply: string };
      expect(spawned.agentId).toEqual(expect.any(String));

      const resumed = (await customTools.delegate!.execute(
        {
          role: NESTED_ROLE,
          prompt: RECALL_PROMPT,
          resumeId: spawned.agentId,
        },
        {},
      )) as { agentId: string; reply: string };

      // Landing on the same agent is necessary but not sufficient: a resume
      // that lost the first turn would answer under the same id and know
      // nothing, which is the failure a grill relay cannot survive.
      expect(resumed.agentId).toBe(spawned.agentId);
      expect(resumed.reply.toLowerCase()).toContain(CODE_WORD);
    },
    TWO_TURN_TIMEOUT_MS,
  );
});
