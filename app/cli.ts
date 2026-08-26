#!/usr/bin/env -S npx tsx
// One-time setup: npm link in this plugin's app/ directory, then invoke as
// `issue <verb>` — see SPEC CLI invariants
// (/root/.cursor/plugins/local/issue-tracker/app).
import { runIssueCli } from "./cli-program.js";

function handleStreamError(err: NodeJS.ErrnoException): void {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
  throw err;
}

process.stdout.on("error", handleStreamError);
process.stderr.on("error", handleStreamError);

const { stdout, stderr, status } = await runIssueCli(process.argv.slice(2));
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exit(status);
