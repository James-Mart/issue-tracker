import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

if (process.platform === "linux") {
  writeFileSync("/proc/self/oom_score_adj", "1000");
}

function writeWorkerHeapReport(): void {
  const reportDir = process.env.VITEST_HEAP_REPORT_DIR;
  if (!reportDir) {
    return;
  }

  const workerState = (
    globalThis as {
      __vitest_worker__?: { filepath?: string; config?: { root?: string } };
    }
  ).__vitest_worker__;
  const filepath = workerState?.filepath;
  if (!filepath) {
    return;
  }

  const root = workerState.config?.root ?? process.cwd();
  const file = relative(root, filepath);
  writeFileSync(
    join(reportDir, `worker-${process.pid}.json`),
    JSON.stringify({ pid: process.pid, file }),
  );
}

writeWorkerHeapReport();

function exitWhenParentDisconnects(): void {
  process.kill(process.pid, "SIGTERM");
}

process.on("disconnect", exitWhenParentDisconnects);

// A SIGKILL'd parent closes IPC without emitting `disconnect`.
if (typeof process.send === "function") {
  const watchParent = setInterval(() => {
    if (!process.connected) {
      clearInterval(watchParent);
      exitWhenParentDisconnects();
    }
  }, 100);
}
