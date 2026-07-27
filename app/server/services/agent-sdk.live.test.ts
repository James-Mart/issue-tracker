import { join } from "path";
import type { AgentDefinition } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import {
  agentSdk,
  type AgentHandle,
  type AgentSendOptions,
  type AgentStreamEvent,
} from "./agent-sdk.js";

// Live SDK suite: authored and preserved, but excluded from the default
// `npm test` (which must never contact the SDK/network or spend tokens).
// Enabled only via `npm run test:live`, which sets `CURSOR_SDK_LIVE` and
// requires a real `CURSOR_API_KEY`.

/** A real turn outlives vitest's default per-test timeout many times over. */
const LIVE_TIMEOUT_MS = 300_000;

const STORE_DIR = join(process.cwd(), ".agent-state-test");

/**
 * Parent for the pin measurements. A parent takes a base catalog ID, and this
 * one differs from every pin under test, so an observed pin can never be a
 * silent inherit wearing the pin's name.
 */
const PARENT_MODEL = { id: "claude-sonnet-4-5" };

/** The two subagent slugs this repo pins its own roles to. */
const COMPOSER_PIN = "composer-2.5";
const GROK_PIN = "cursor-grok-4.5-high-fast";

const PROBE_PROMPT = "Reply with the single word ok.";

function probeDefinition(model: string): AgentDefinition {
  return {
    description: "Model-pin probe. Replies with a single word.",
    prompt: PROBE_PROMPT,
    model: { id: model },
  };
}

/**
 * The model a nested spawn actually ran on. The runtime fills `args.model` on
 * the task tool call with the model it resolved, so when the parent passes no
 * spawn-time model this reports the resolution rather than echoing a request.
 */
function taskCallModel(event: AgentStreamEvent): string | undefined {
  if (event.kind !== "message") return undefined;
  const { message } = event;
  if (message.type !== "tool_call") return undefined;
  if (typeof message.args !== "object" || message.args === null) {
    return undefined;
  }
  const { model } = message.args as { model?: unknown };
  return typeof model === "string" ? model : undefined;
}

/**
 * Spawn `role` with no spawn-time model from `agent` and report every distinct
 * effective nested model observed on the Task call.
 */
async function nestedModelsFrom(
  agent: AgentHandle,
  role: string,
  sendOptions?: AgentSendOptions,
): Promise<string[]> {
  const run = await agent.send(
    `Call the Task tool exactly once, with subagent_type "${role}", ` +
      `description "model probe", and prompt "${PROBE_PROMPT}". ` +
      "Pass no model argument on that call. " +
      "Then reply with the single word done.",
    sendOptions,
  );

  const models = new Set<string>();
  for await (const event of run) {
    const model = taskCallModel(event);
    if (model) models.add(model);
  }
  await run.wait();

  return [...models];
}

/**
 * Spawn `role` from an `agents` map with no spawn-time model and report every
 * distinct effective nested model observed.
 */
async function nestedModelsFor(
  role: string,
  agents: Record<string, AgentDefinition>,
): Promise<string[]> {
  await using agent = await agentSdk.createAgent({
    cwd: process.cwd(),
    model: PARENT_MODEL,
    storeDir: STORE_DIR,
    agents,
  });
  return nestedModelsFrom(agent, role);
}

/**
 * Same measurement as {@link nestedModelsFor}, but after disposing the create
 * handle and rehydrating via `resumeAgent` — the path the app takes after a
 * process restart. Resume gets the map only (no `cwd` / `settingSources`);
 * the parent model is supplied on `send`, since local resume does not restore
 * the create-time model for subsequent turns.
 */
async function nestedModelsAfterResume(
  role: string,
  agents: Record<string, AgentDefinition>,
): Promise<string[]> {
  const created = await agentSdk.createAgent({
    cwd: process.cwd(),
    model: PARENT_MODEL,
    storeDir: STORE_DIR,
    agents,
  });
  const agentId = created.agentId;
  // Persist a turn so resume has real stored state, matching a conversation
  // that already ran before the process died.
  {
    const warm = await created.send('Reply with the single word "hi".');
    for await (const _ of warm) {
      // Drain; content unused.
    }
    await warm.wait();
  }
  await created[Symbol.asyncDispose]();

  await using agent = await agentSdk.resumeAgent(agentId, STORE_DIR, {
    cwd: process.cwd(),
    model: PARENT_MODEL,
    agents,
  });
  return nestedModelsFrom(agent, role, { model: PARENT_MODEL });
}

describe.skipIf(!process.env.CURSOR_SDK_LIVE)("agent-sdk (live)", () => {
  it("lists real models", async () => {
    const models = await agentSdk.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => typeof m.id === "string")).toBe(true);
  });

  it(
    "runs a prompt to completion through the merged stream",
    async () => {
      await using agent = await agentSdk.createAgent({
        cwd: process.cwd(),
        model: { id: "composer-2.5" },
        storeDir: STORE_DIR,
      });

      const run = await agent.send('Reply with the single word "pong".');
      const events: AgentStreamEvent[] = [];
      for await (const event of run) {
        events.push(event);
      }
      const result = await run.wait();

      expect(events.some((e) => e.kind === "message")).toBe(true);
      expect(result.status).toBe("finished");
    },
    LIVE_TIMEOUT_MS,
  );

  // The pin these two slugs carry is the mechanism the whole SDK surface rests
  // on: the map is the only thing selecting the nested model here. Both were
  // absent from the single-slug list the SDK advertises for spawn-time use, so
  // their acceptance is measured rather than assumed.
  it.each([COMPOSER_PIN, GROK_PIN])(
    "pins a nested model from the agents map (%s)",
    async (pin) => {
      const role = "model-pin-probe";
      const models = await nestedModelsFor(role, {
        [role]: probeDefinition(pin),
      });

      expect(models).toEqual([pin]);
    },
    LIVE_TIMEOUT_MS,
  );

  // Boundary tests only prove the map reaches Agent.resume. This measures
  // whether resume still resolves the pin when cwd / settingSources are absent
  // — the options this Story deliberately does not forward.
  it(
    "pins a nested model from the agents map after resume",
    async () => {
      const role = "model-pin-probe";
      const pin = COMPOSER_PIN;
      const models = await nestedModelsAfterResume(role, {
        [role]: probeDefinition(pin),
      });

      expect(models).toEqual([pin]);
    },
    LIVE_TIMEOUT_MS,
  );

  // The SDK documents inline `agents` as overriding file-based definitions of
  // the same name, but not the case this plugin lives in: the file-based side
  // arriving through `settingSources: ["plugins"]`. `issue-tracker-plan-dry` is
  // registered that way, and is read-only if the inline definition ever loses.
  it(
    "prefers an inline definition over the plugin-registered agent of the same name",
    async () => {
      const role = "issue-tracker-plan-dry";
      const models = await nestedModelsFor(role, {
        [role]: probeDefinition(GROK_PIN),
      });

      expect(models).toEqual([GROK_PIN]);
    },
    LIVE_TIMEOUT_MS,
  );
});
