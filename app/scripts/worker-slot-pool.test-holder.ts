// Slot holder process for worker-slot-pool.test.ts.
// argv: <dir> <requested> <mode> <availableParallelism> <totalmem>
// Prints `granted <slots>` once its lease is written, then by mode:
//   hold   — stays alive until killed
//   orphan — leaves `sleep` running in its process group, then dies by SIGKILL
//   exit   — exits normally

import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import os from "node:os";
import { acquireWorkerSlots } from "./worker-slot-pool.js";

const [dir, requested, mode, parallelism, totalmem] = process.argv.slice(2);
os.availableParallelism = () => Number(parallelism);
os.totalmem = () => Number(totalmem);

const slots = await acquireWorkerSlots(Number(requested), dir);

if (mode === "orphan") {
  const orphan = spawn("sleep", ["60"], { stdio: "ignore" });
  await new Promise((resolve) => orphan.once("spawn", resolve));
  writeSync(1, `granted ${slots}\n`);
  process.kill(process.pid, "SIGKILL");
} else if (mode === "hold") {
  writeSync(1, `granted ${slots}\n`);
  setInterval(() => {}, 60_000);
} else if (mode === "exit") {
  writeSync(1, `granted ${slots}\n`);
} else {
  throw new Error(`unknown holder mode: ${mode}`);
}
