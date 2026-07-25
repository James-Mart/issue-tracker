import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentDefinition, SDKCustomTool } from "@cursor/sdk";
import type { AgentRun, AgentSdk } from "./agent-sdk.js";
import { resolveModelSelection } from "./model-selection.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";

export interface DelegateToolOptions {
  sdk: AgentSdk;
  cwd: string;
  /** Conversation agent-state directory; nested stores are created under it. */
  storeDir: string;
  agents?: Record<string, AgentDefinition>;
  /** Override agents directory (tests). Defaults to the plugin `agents/`. */
  agentsDir?: string;
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`delegate: missing or invalid ${key}`);
  }
  return value;
}

async function collectAssistantText(run: AgentRun): Promise<string> {
  let reply = "";
  for await (const event of run) {
    if (event.kind !== "message") continue;
    if (event.message.type !== "assistant") continue;
    for (const block of event.message.message.content) {
      if (block.type === "text") reply += block.text;
    }
  }
  return reply;
}

/**
 * Build the `customTools` map containing the app-hosted `delegate` bridge.
 * The same map is passed to every nested agent so delegation works at any depth.
 */
export function createDelegateCustomTools(
  options: DelegateToolOptions,
): Record<string, SDKCustomTool> {
  const customTools: Record<string, SDKCustomTool> = {};

  customTools.delegate = {
    description:
      "Delegate work to a named role. The app selects the role's pinned model.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Spawnable role name (agents/<role>.md).",
        },
        prompt: {
          type: "string",
          description: "Task prompt for the nested agent.",
        },
      },
      required: ["role", "prompt"],
    },
    execute: async (args) => {
      const role = requireString(args, "role");
      const prompt = requireString(args, "prompt");
      const agentsDir = options.agentsDir;

      const pin = loadRoleModelPin(role, agentsDir);
      const model = resolveModelSelection(pin);
      const roleBody = loadRoleBody(role, agentsDir);
      const fullPrompt = `${roleBody}\n\n${prompt}`;

      const nestedStoreDir = join(options.storeDir, "nested", randomUUID());
      mkdirSync(nestedStoreDir, { recursive: true });

      const handle = await options.sdk.createAgent({
        cwd: options.cwd,
        model,
        storeDir: nestedStoreDir,
        agents: options.agents,
        customTools,
      });

      try {
        const run = await handle.send(fullPrompt);
        const reply = await collectAssistantText(run);
        const waited = await run.wait();
        if (waited.status === "error") {
          throw new Error(
            waited.error?.message ?? `delegate: nested run ${waited.id} failed`,
          );
        }
        if (waited.status === "cancelled") {
          throw new Error(`delegate: nested run ${waited.id} was cancelled`);
        }
        return { agentId: handle.agentId, reply };
      } finally {
        try {
          await handle[Symbol.asyncDispose]();
        } catch {
          // Best-effort dispose after the reply is collected.
        }
      }
    },
  };

  return customTools;
}
