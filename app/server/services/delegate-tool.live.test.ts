import { join } from "path";
import type { ModelSelection } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import { agentSdk, type AgentHandle, type AgentSdk } from "./agent-sdk.js";
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
});
