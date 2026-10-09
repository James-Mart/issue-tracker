import { readFileSync, writeFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  load,
  runLiveMarkerPath,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

function readCurrentProcStartTime(pid: number = process.pid): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const startTime = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (!startTime) throw new Error(`unparseable /proc/${pid}/stat`);
  return Number(startTime);
}

describe("isRunLive", () => {
  it("reports not live when a new marker's start time does not match the live pid", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "Start time mismatch",
      projectId: "platform",
      model: "auto",
    });

    writeFileSync(
      runLiveMarkerPath(meta.id),
      `${JSON.stringify({
        pid: process.pid,
        bootId: "current-boot-id",
        processStartedAt: readCurrentProcStartTime() - 1,
      })}\n`,
    );
    expect(isRunLive(meta.id)).toBe(false);
  });
});
