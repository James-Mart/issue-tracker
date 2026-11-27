import type { Command } from "commander";
import { agentSessions } from "./server/services/agent-sessions.js";
import { concludeIdea, parseConcludeRequest } from "./server/services/idea-conclude.js";

type Run = (action: () => unknown) => Promise<void>;

export function registerIdeaCommands(kindCmd: Command, run: Run): void {
  kindCmd
    .command("conclude")
    .argument("<ideaId>", "idea id")
    .requiredOption("--outline <outlineId>", "outline this idea concludes onto")
    .requiredOption(
      "--code-gate-verdict <verdict>",
      "gated or start",
    )
    .description(
      "archive the idea, copy its plan settings onto the outline, and maybe start a decomposer",
    )
    .action(
      (
        ideaId: string,
        opts: { outline: string; codeGateVerdict: string },
      ) =>
        run(async () => {
          const request = parseConcludeRequest({
            outlineId: opts.outline,
            codeGateVerdict: opts.codeGateVerdict,
          });
          const result = await concludeIdea(
            ideaId,
            request.outlineId,
            request.codeGateVerdict,
            agentSessions,
          );
          process.stdout.write(`${result.concludedAt}\n`);
          if (result.sessionId) {
            process.stdout.write(`${result.sessionId}\n`);
          }
        }),
    );
}
