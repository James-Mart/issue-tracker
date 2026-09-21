import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
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
  it("reports not live when the marker is missing", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "No marker",
      projectId: "platform",
      model: "auto",
    });

    expect(isRunLive(meta.id)).toBe(false);
  });

  it("reports live for a started run and not live after it finishes", async () => {
    const { createConversation, createAgentSessions, isRunLive } = await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sessions = createAgentSessions(createFakeAgentSdk({ hold }));
    const meta = await createConversation({
      title: "Run live",
      projectId: "platform",
      model: "auto",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(isRunLive(meta.id)).toBe(true);
    const marker = JSON.parse(
      readFileSync(runLiveMarkerPath(meta.id), "utf8"),
    );
    expect(marker).toEqual({
      pid: process.pid,
      bootId: expect.any(String),
      processStartedAt: readCurrentProcStartTime(),
    });
    expect(marker.bootId.length).toBeGreaterThan(0);

    release();
    await result.run.wait();
    expect(isRunLive(meta.id)).toBe(false);
    expect(existsSync(runLiveMarkerPath(meta.id))).toBe(false);
  });

  it("reports not live when the marker names a process that is no longer running", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "Dead pid",
      projectId: "platform",
      model: "auto",
    });
    const child = spawn("true", [], { stdio: "ignore" });
    const pid = child.pid;
    if (pid === undefined) throw new Error("expected spawned pid");
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });

    writeFileSync(runLiveMarkerPath(meta.id), `${JSON.stringify({ pid })}\n`);
    expect(isRunLive(meta.id)).toBe(false);
  });

  it("reports live for a legacy marker whose pid is still running", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "Legacy marker",
      projectId: "platform",
      model: "auto",
    });

    writeFileSync(
      runLiveMarkerPath(meta.id),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
    expect(isRunLive(meta.id)).toBe(true);
  });

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

  it("reports live when the start time matches even if bootId differs", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "Different boot id",
      projectId: "platform",
      model: "auto",
    });

    writeFileSync(
      runLiveMarkerPath(meta.id),
      `${JSON.stringify({
        pid: process.pid,
        bootId: "previous-boot-id",
        processStartedAt: readCurrentProcStartTime(),
      })}\n`,
    );
    expect(isRunLive(meta.id)).toBe(true);
  });

  it("throws when the marker cannot be parsed", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "Broken marker",
      projectId: "platform",
      model: "auto",
    });

    writeFileSync(runLiveMarkerPath(meta.id), "not-json\n");
    expect(() => isRunLive(meta.id)).toThrow(/unparseable run-live marker/);
  });
});
