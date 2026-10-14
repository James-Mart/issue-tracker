import type { Command } from "commander";
import { coerceJson } from "./cli-coerce.js";
import { readCliFileArg } from "./cli-io.js";
import {
  markStandardsApplied,
  setReviewStandards,
} from "./server/services/review-standards.js";

type Run = (action: () => unknown) => Promise<void>;

/** `issue review standards set|applied <reviewId> <submissionId> …`. */
export function registerReviewStandardsCommands(kindCmd: Command, run: Run): void {
  const standards = kindCmd
    .command("standards")
    .description("coding-standards assessment on a review submission");

  standards
    .command("set")
    .argument("<reviewId>", "review id")
    .argument("<submissionId>", "submission id")
    .argument("<file>", "JSON file { proposals } (use - for stdin)")
    .description(
      "record proposals for an assessing submission (ready, or noGaps when empty)",
    )
    .action((reviewId: string, submissionId: string, file: string) =>
      run(() => {
        const status = setReviewStandards(
          reviewId,
          submissionId,
          coerceJson(readCliFileArg(file), "standards file"),
        );
        process.stdout.write(`${status}\n`);
      }),
    );

  standards
    .command("applied")
    .argument("<reviewId>", "review id")
    .argument("<submissionId>", "submission id")
    .description("report accepted edits written to the coding-standards doc (applying to applied)")
    .action((reviewId: string, submissionId: string) =>
      run(() => {
        markStandardsApplied(reviewId, submissionId);
        process.stdout.write("applied\n");
      }),
    );
}
