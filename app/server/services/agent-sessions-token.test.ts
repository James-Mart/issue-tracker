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
  it("drops the stale handle and replays the prompt after an in-band auth failure", async () => {
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

    // The first handle is gone — that release is what lets the SDK's refcounted
    // executor cache reach zero and mint a new token — and the same prompt ran
    // again on its replacement.
    expect(fake.handles[0]?.disposed).toBe(true);
    expect(fake.handles).toHaveLength(2);
    expect(fake.handles[1]?.sends).toEqual([{ message: "go", options: {} }]);
    expect(fake.handles[1]?.disposed).toBe(false);

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

    expect(fake.handles[1]?.sends).toEqual([
      { message: "go", options: { model: { id: "auto" } } },
    ]);
  });

  it("replays once and then surfaces the failure", async () => {
    const { createConversation, createAgentSessions } = await load();
    // Detected off the terminal result this time, with an empty stream.
    const authResult = {
      id: FAKE_RUN_ID,
      status: "error" as const,
      error: { message: AUTH_ERROR_TEXT },
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
    expect(fake.handles).toHaveLength(2);
  });

  it("leaves a run in flight and other workspaces untouched", async () => {
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
        // The busy sibling starts first and stays streaming; the third send is
        // the one whose token has expired.
        { hold },
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

    const [busyHandle, elsewhereHandle, failedHandle] = fake.handles;
    // Cancelling live work to repair a different conversation is not a trade
    // worth making, and another workspace keys a different executor entirely.
    expect(busyHandle?.disposed).toBe(false);
    expect(busyHandle?.cancelled).toBe(false);
    expect(elsewhereHandle?.disposed).toBe(false);
    expect(failedHandle?.disposed).toBe(true);

    releaseHold();
    if (busyRun.ok) await busyRun.run.wait();
    rmSync(otherWorkspace, { recursive: true, force: true });
  });
});
