import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseTmp = tmpdir();
const workerTmp = mkdtempSync(join(baseTmp, "vitest-worker-"));

process.env.TMPDIR = workerTmp;
process.env.TMP = workerTmp;
process.env.TEMP = workerTmp;

process.on("exit", () => {
  rmSync(workerTmp, { recursive: true, force: true });
});
