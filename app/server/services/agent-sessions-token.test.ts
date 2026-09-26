import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildAuthFailureStream,
  createFakeAgentSdk,
  FAKE_RUN_ID,
} from "./agent-sdk.fake.js";
import {
  AT,
  load,
  useAgentSessionsTestFixtures,
  writeIssue,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

const AUTH_ERROR_TEXT =
  "Authentication error. If you are logged in, try logging out and back in.";

describe("expired access token recovery", () => {
  it("replays the prompt once on the same handle after an in-band auth failure", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    // The failure arrives in-band while the run itself reports finished, so
    // this pins the event-driven detection rather than the terminal result.
    const fake = createFakeAgentSdk({
      sendScript: [{ stream: buildAuthFailureStream() }],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Token expired",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "finished",
    });

    // The SDK invalidates its own token cache, so the replay stays on the
    // handle that just failed.
    expect(fake.handles).toHaveLength(1);
    expect(fake.handles[0]?.disposed).toBe(false);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "go", options: {} },
      { message: "go", options: {} },
    ]);

    const { transcript } = readConversation(meta.id);
    expect(transcript.find((e) => e.type === "status" && e.status === "RETRYING"))
      .toBeDefined();
  });

  it("carries the per-send model override onto the replay", async () => {
    const { createConversation, createAgentSessions } = await load();
    const fake = createFakeAgentSdk({
      sendScript: [{ stream: buildAuthFailureStream() }],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Token expired mid override",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, {
      prompt: "go",
      model: "auto",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.handles).toHaveLength(1);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "go", options: { model: { id: "auto" } } },
      { message: "go", options: { model: { id: "auto" } } },
    ]);
  });

  it("replays once and then surfaces the failure", async () => {
    const { createConversation, createAgentSessions } = await load();
    // Detected off the terminal result this time, with an empty stream.
    const authResult = {
      id: FAKE_RUN_ID,
      status: "error" as const,
      error: { message: "token expired", code: "AUTH_TOKEN_EXPIRED" },
    };
    const fake = createFakeAgentSdk({
      sendScript: [
        { stream: [], waitResult: authResult },
        { stream: [], waitResult: authResult },
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Auth broken outright",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await result.run.wait()).toEqual(authResult);
    // Exactly one replay: a key that is genuinely bad must not loop.
    expect(fake.handles).toHaveLength(1);
    expect(fake.handles[0]?.sends).toHaveLength(2);
  });

  it("replays after a code-only terminal auth error on the pump path", async () => {
    const { createConversation, createAgentSessions } = await load();
    const authResult = {
      id: FAKE_RUN_ID,
      status: "error" as const,
      error: { message: "unauthenticated", code: "unauthenticated" },
    };
    const fake = createFakeAgentSdk({
      sendScript: [
        { stream: [], waitResult: authResult },
        { stream: [], waitResult: authResult },
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Code-only auth failure",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await result.run.wait()).toEqual(authResult);
    expect(fake.handles).toHaveLength(1);
    expect(fake.handles[0]?.disposed).toBe(false);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "go", options: {} },
      { message: "go", options: {} },
    ]);
  });

  it("leaves sibling sessions and other workspaces untouched", async () => {
    const { createConversation, createAgentSessions } = await load();

    const otherWorkspace = mkdtempSync(join(tmpdir(), "issue-session-ws2-"));
    mkdirSync(join(otherWorkspace, ".git"));
    writeIssue("other", {
      kind: "project",
      title: "Other",
      workspace: otherWorkspace,
      createdAt: AT,
      updatedAt: AT,
    });

    let releaseHold: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const fake = createFakeAgentSdk({
      sendScript: [
        // Busy sibling stays streaming. Idle same-cwd and other-workspace
        // sends finish. The last scripted send is the expired token.
        { hold },
        {},
        {},
        { stream: buildAuthFailureStream() },
      ],
    });
    const sessions = createAgentSessions(fake);

    const busy = await createConversation({
      title: "Busy sibling",
      projectId: "platform",
      model: "composer-2.5",
    });
    const idle = await createConversation({
      title: "Idle sibling",
      projectId: "platform",
      model: "composer-2.5",
    });
    const elsewhere = await createConversation({
      title: "Different workspace",
      projectId: "other",
      model: "composer-2.5",
    });
    const failing = await createConversation({
      title: "Token expired",
      projectId: "platform",
      model: "composer-2.5",
    });

    const busyRun = await sessions.sendPrompt(busy.id, { prompt: "busy" });
    expect(busyRun.ok).toBe(true);
    const idleRun = await sessions.sendPrompt(idle.id, { prompt: "idle" });
    expect(idleRun.ok).toBe(true);
    if (idleRun.ok) await idleRun.run.wait();
    // Give the other workspace a live handle without leaving a run in flight.
    const elsewhereRun = await sessions.sendPrompt(elsewhere.id, {
      prompt: "elsewhere",
    });
    expect(elsewhereRun.ok).toBe(true);
    if (elsewhereRun.ok) await elsewhereRun.run.wait();

    const failingRun = await sessions.sendPrompt(failing.id, { prompt: "go" });
    expect(failingRun.ok).toBe(true);
    if (!failingRun.ok) return;
    await failingRun.run.wait();

    const [busyHandle, idleHandle, elsewhereHandle, failedHandle] = fake.handles;
    expect(busyHandle?.disposed).toBe(false);
    expect(busyHandle?.cancelled).toBe(false);
    expect(idleHandle?.disposed).toBe(false);
    expect(idleHandle?.cancelled).toBe(false);
    expect(elsewhereHandle?.disposed).toBe(false);
    expect(failedHandle?.disposed).toBe(false);
    expect(failedHandle?.sends).toHaveLength(2);

    releaseHold();
    if (busyRun.ok) await busyRun.run.wait();
    rmSync(otherWorkspace, { recursive: true, force: true });
  });
});
