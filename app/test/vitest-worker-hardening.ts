import { writeFileSync } from "node:fs";

if (process.platform === "linux") {
  writeFileSync("/proc/self/oom_score_adj", "1000");
}

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
