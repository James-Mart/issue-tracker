import type { Command } from "commander";
import {
  OUTLINE_CHECK_VERDICTS,
  recordOutlineCheckVerdict,
} from "./server/services/review-outline-check.js";

type Run = (action: () => unknown) => Promise<void>;

const VERDICT_DESCRIPTIONS = {
  unchanged: "the threads leave the outline as it states things (checking to settled)",
  proposed: "the pending draft holds the amended outline (to waiting at the outline gate)",
  yes: "save the pending draft as the next version (waiting to settled)",
  "not-now": "discard the pending draft (waiting to settled at the current version)",
} as const satisfies Record<(typeof OUTLINE_CHECK_VERDICTS)[number], string>;

/** `issue review outline-check unchanged|proposed|yes|not-now <reviewId> <submissionId>`. */
export function registerReviewOutlineCheckCommands(kindCmd: Command, run: Run): void {
  const outlineCheck = kindCmd
    .command("outline-check")
    .description("outline check verdict on a review submission");

  for (const verdict of OUTLINE_CHECK_VERDICTS) {
    outlineCheck
      .command(verdict)
      .argument("<reviewId>", "review id")
      .argument("<submissionId>", "submission id")
      .description(VERDICT_DESCRIPTIONS[verdict])
      .action((reviewId: string, submissionId: string) =>
        run(async () => {
          const check = await recordOutlineCheckVerdict(reviewId, submissionId, verdict);
          const line =
            check.status === "settled" ? `settled ${check.version}` : check.status;
          process.stdout.write(`${line}\n`);
        }),
      );
  }
}
