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

describe("isRunLive", () => {
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
    expect(JSON.parse(readFileSync(runLiveMarkerPath(meta.id), "utf8"))).toEqual(
      { pid: process.pid },
    );

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

  it("reads liveness from the marker without the in-process session map", async () => {
    const { createConversation, isRunLive } = await load();
    const meta = await createConversation({
      title: "File only",
      projectId: "platform",
      model: "auto",
    });

    writeFileSync(
      runLiveMarkerPath(meta.id),
      `${JSON.stringify({ pid: process.pid })}\n`,
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
