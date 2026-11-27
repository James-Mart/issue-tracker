import type { LocalToolExecutor } from "@cursor/sdk";
import {
  decidePortKillPermission,
  resolveConversationsDir,
} from "../../hooks/port-kill-guard.mjs";
import { stripCursorAttribution } from "../../hooks/strip-cursor-attribution.mjs";

type PortKillDecision = ReturnType<typeof decidePortKillPermission>;

const STRIP_FAILED = "attribution stripping failed";
const PORT_KILL_GUARD_FAILED = "the port-kill guard failed";

/** Conversation the port-kill guard decides for. Prewarm leaves it unset. */
export interface ShellConversationBinding {
  conversationId: string | undefined;
}

export interface HostShellDeps {
  /** Test double. Production receives the SDK shell as `execute`'s last argument. */
  host?: LocalToolExecutor;
  conversationsDir?: string;
  stripAttribution?: (command: string) => string | null;
  decidePortKill?: typeof decidePortKillPermission;
}

export interface SessionShellExecutor extends LocalToolExecutor {
  readonly conversationId: string | undefined;
}

/**
 * One shell executor for a local session, shared with its Task children.
 *
 * The SDK object registered in its place does not receive the default shell.
 * `execute`'s last argument, when it is a shell, is that default — supplied
 * by `sdk-shell-host-binding` — and an allowed command runs through it.
 */
export function hostShellExecutor(
  binding: ShellConversationBinding,
  deps: HostShellDeps = {},
): SessionShellExecutor {
  const strip = deps.stripAttribution ?? stripCursorAttribution;
  const decide = deps.decidePortKill ?? decidePortKillPermission;
  const conversationsDir = deps.conversationsDir ?? resolveConversationsDir();

  return {
    get conversationId() {
      return binding.conversationId;
    },
    async execute(...args: never[]): Promise<unknown> {
      const received = args as unknown[];
      const request = shellRequest(received[1]);
      const host = sdkShell(received, deps.host);

      // A throw from strip or the guard must stay a shell result. The process
      // does not start, and the model sees that reason rather than a tool error.
      let rewritten: string | null;
      try {
        rewritten = strip(request.command);
      } catch {
        return refusedShell(request, STRIP_FAILED);
      }
      const command = rewritten ?? request.command;

      let decision: PortKillDecision;
      try {
        decision = decide({
          command,
          conversationId: binding.conversationId,
          conversationsDir,
        });
      } catch {
        return refusedShell(request, PORT_KILL_GUARD_FAILED);
      }
      if (decision.permission === "deny") {
        return refusedShell(request, decision.agent_message);
      }

      if (command !== request.command) request.record.command = command;
      return host.execute(...args);
    },
  };
}

/** Record the agent id the session stores as its Cursor conversation id. */
export function bindSessionAgent(
  binding: ShellConversationBinding,
  agentId: string,
): void {
  if (agentId.length === 0) {
    throw new Error("session agent id is empty");
  }
  binding.conversationId = agentId;
}

interface ShellRequest {
  command: string;
  workingDirectory: string;
  record: Record<string, unknown>;
}

function shellRequest(value: unknown): ShellRequest {
  if (value === null || typeof value !== "object") {
    throw new Error("shell request has no command");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.command !== "string") {
    throw new Error("shell request has no command");
  }
  if (
    "workingDirectory" in record &&
    record.workingDirectory !== undefined &&
    typeof record.workingDirectory !== "string"
  ) {
    throw new Error("shell request workingDirectory is not a string");
  }
  // The shell result's workingDirectory is a string. Omitted means empty.
  const workingDirectory =
    typeof record.workingDirectory === "string" ? record.workingDirectory : "";
  return { command: record.command, workingDirectory, record };
}

function sdkShell(
  args: unknown[],
  fallback: LocalToolExecutor | undefined,
): LocalToolExecutor {
  const last = args[args.length - 1];
  if (args.length >= 4 && isLocalToolExecutor(last)) return last;
  if (fallback !== undefined) return fallback;
  throw new Error("host shell executor is not bound");
}

function isLocalToolExecutor(value: unknown): value is LocalToolExecutor {
  return (
    typeof value === "object" &&
    value !== null &&
    "execute" in value &&
    typeof (value as { execute: unknown }).execute === "function"
  );
}

function refusedShell(request: ShellRequest, reason: string) {
  return {
    result: {
      case: "rejected" as const,
      value: {
        command: request.command,
        workingDirectory: request.workingDirectory,
        reason,
      },
    },
  };
}
