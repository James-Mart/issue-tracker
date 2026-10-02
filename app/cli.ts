import { runIssueCli } from "./cli-program.js";
import { assertGuestBoot } from "./server/services/guest-boot.js";

assertGuestBoot();

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
