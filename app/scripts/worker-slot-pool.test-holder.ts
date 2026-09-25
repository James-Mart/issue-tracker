// Slot holder process for worker-slot-pool.test.ts.
// argv: <dir> <requested> <mode> <availableParallelism> <totalmem> [all]
// Prints `granted <slots>` once its lease is written, then by mode:
//   hold   — stays alive until killed
//   orphan — leaves `sleep` running in its process group, then dies by SIGKILL
//   exit   — exits normally

import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import os from "node:os";
import { acquireAllWorkerSlots, acquireWorkerSlots } from "./worker-slot-pool.js";

const [dir, requested, mode, parallelism, totalmem, acquireMode] = process.argv.slice(2);
os.availableParallelism = () => Number(parallelism);
os.totalmem = () => Number(totalmem);

const count = Number(requested);
let granted: number;
if (acquireMode === "all") {
  await acquireAllWorkerSlots(count, dir);
  granted = count;
} else {
  granted = await acquireWorkerSlots(count, dir);
}

if (mode === "orphan") {
  const orphan = spawn("sleep", ["60"], { stdio: "ignore" });
  await new Promise((resolve) => orphan.once("spawn", resolve));
  writeSync(1, `granted ${granted}\n`);
  process.kill(process.pid, "SIGKILL");
} else if (mode === "hold") {
  writeSync(1, `granted ${granted}\n`);
  setInterval(() => {}, 60_000);
} else if (mode === "exit") {
  writeSync(1, `granted ${granted}\n`);
} else {
  throw new Error(`unknown holder mode: ${mode}`);
}
