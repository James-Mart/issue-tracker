import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import {
  buildAuthFailureStream,
  createFakeAgentSdk,
  FAKE_AGENT_ID,
  FAKE_RUN_ID,
} from "./agent-sdk.fake.js";
import {
  AT,
  issuesRoot,
  load,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

const AUTH_ERROR_TEXT =
  "Authentication error. If you are logged in, try logging out and back in.";

const RETRYING_MESSAGE =
  "The agent session's access token had expired. Reconnected and resumed the conversation.";

const CUT_SHORT_MESSAGE =
  "The previous turn was cut short by an expired session token. Please carry on.";

/** A spawnable role the plugin ships, so the bridge finds a body and a pin. */
const DELEGATE_ROLE = "issue-tracker-research";

describe("delegation auth escalation", () => {
  /**
   * A nested run carrying the in-band auth status, whose own terminal result is
   * the auth error the bridge classifies on.
   */
  function nestedAuthFailure() {
    return {
      stream: buildAuthFailureStream(),
      waitResult: {
        id: "run-nested-auth",
        status: "error" as const,
        error: { message: AUTH_ERROR_TEXT },
      },
    };
  }

  async function waitFor(
    label: string,
    predicate: () => boolean,
  ): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  it("cancels the live turn and resends the prompt when the turn made no progress", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    let releaseRoot!: () => void;
    const rootHold = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const fake = createFakeAgentSdk({
      stream: [],
      sendScript: [
        // The root turn stays live while the delegation runs — it is the handle
        // awaiting the tool call, and the one holding the executor open.
        { hold: rootHold },
        nestedAuthFailure(),
        {},
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Nested token expired",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;

    const delegated = await delegate.execute(
      { role: DELEGATE_ROLE, prompt: "commit it" },
      { toolCallId: "call-delegate-auth" },
    );
    // The calling model still receives the failure as data.
    expect(delegated).toMatchObject({ ok: false, failureClass: "auth" });

    // The escalation cancelled the root turn rather than letting the model keep
    // retrying against a stale executor.
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "cancelled",
    });
    const rootHandle = fake.handles.find(
      (handle) => handle.agentId === FAKE_AGENT_ID && handle.cancelled,
    );
    expect(rootHandle?.cancelled).toBe(true);
    releaseRoot();

    await waitFor("the re-entered turn", () => fake.resumed.length === 1);

    // The stale handle is gone — its release is what lets the SDK's refcounted
    // executor cache reach zero and mint a new token.
    expect(rootHandle?.disposed).toBe(true);
    expect(fake.resumed[0]?.agentId).toBe(FAKE_AGENT_ID);
    const replayHandle = fake.handles.find(
      (handle) => handle.agentId === FAKE_AGENT_ID && !handle.cancelled,
    );
    expect(replayHandle?.sends).toEqual([{ message: "go", options: {} }]);

    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "status" && e.status === "RETRYING"),
    ).toEqual([expect.objectContaining({ message: RETRYING_MESSAGE })]);
    expect(
      transcript.filter((e) => e.type === "delegation_recovery"),
    ).toEqual([
      expect.objectContaining({
        type: "delegation_recovery",
        failureClass: "auth",
        madeProgress: false,
        cancelledDelegations: 1,
        message: expect.stringContaining("had made no progress"),
      }),
    ]);

    const delegateCalls = transcript.filter(
      (e) => e.type === "tool_call" && e.name === "delegate",
    );
    expect(delegateCalls.some((e) => e.status === "running")).toBe(false);
    expect(delegateCalls).toEqual([
      expect.objectContaining({
        type: "tool_call",
        callId: "call-delegate-auth",
        name: "delegate",
        status: "error",
        result: expect.objectContaining({
          status: "error",
          failureClass: "auth",
          message: AUTH_ERROR_TEXT,
        }),
      }),
    ]);
  });

  it("re-enters with a continuation prompt when the cancelled turn made progress", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    let releaseRoot!: () => void;
    const rootHold = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const fake = createFakeAgentSdk({
      stream: [],
      sendScript: [{ hold: rootHold }, nestedAuthFailure(), {}],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Nested token expired mid-progress",
      projectId: "platform",
      model: "composer-2.5",
    });

    // The agent's own run record is where progress comes from: this turn moved
    // its checkpoint forward before the token expired.
    const storeDir = join(
      dirname(issuesRoot),
      "conversations",
      meta.id,
      "agent-state",
    );
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(
      join(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.runs),
      `${JSON.stringify({
        runId: FAKE_RUN_ID,
        agentId: FAKE_AGENT_ID,
        turnNumber: 1,
        status: "cancelled",
        createdAt: 1,
        updatedAt: 1,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "start" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "moved" },
      })}\n`,
    );

    const result = await sessions.sendPrompt(meta.id, {
      prompt: "go",
      model: "auto",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;

    await delegate.execute(
      { role: DELEGATE_ROLE, prompt: "commit it" },
      { toolCallId: "call-delegate-auth" },
    );
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "cancelled",
    });
    releaseRoot();

    await waitFor("the re-entered turn", () => fake.resumed.length === 1);

    // The per-send model override rides along untouched; only the prompt
    // changes, and it prescribes nothing beyond carrying on.
    const replayHandle = fake.handles.find(
      (handle) => handle.agentId === FAKE_AGENT_ID && !handle.cancelled,
    );
    expect(replayHandle?.sends).toEqual([
      { message: CUT_SHORT_MESSAGE, options: { model: { id: "auto" } } },
    ]);

    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "delegation_recovery"),
    ).toEqual([
      expect.objectContaining({
        type: "delegation_recovery",
        failureClass: "auth",
        madeProgress: true,
        cancelledDelegations: 1,
        message: expect.stringContaining("had made progress"),
      }),
    ]);
  });

  it("escalates once per turn however many delegations report the failure", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    let releaseRoot!: () => void;
    const rootHold = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const fake = createFakeAgentSdk({
      stream: [],
      sendScript: [
        { hold: rootHold },
        nestedAuthFailure(),
        nestedAuthFailure(),
        {},
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Two nested failures",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;

    const both = await Promise.all([
      delegate.execute(
        { role: DELEGATE_ROLE, prompt: "first" },
        { toolCallId: "call-delegate-a" },
      ),
      delegate.execute(
        { role: DELEGATE_ROLE, prompt: "second" },
        { toolCallId: "call-delegate-b" },
      ),
    ]);
    for (const delegated of both) {
      expect(delegated).toMatchObject({ ok: false, failureClass: "auth" });
    }

    await result.run.wait();
    releaseRoot();

    await waitFor("the re-entered turn", () => fake.resumed.length === 1);

    await waitFor("delegation recovery", () => {
      const { transcript } = readConversation(meta.id);
      return transcript.some(
        (e) =>
          e.type === "delegation_recovery" &&
          e.cancelledDelegations === 2,
      );
    });

    expect(fake.resumed).toHaveLength(1);
    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "status" && e.status === "RETRYING"),
    ).toHaveLength(1);
    expect(
      transcript.filter((e) => e.type === "delegation_recovery"),
    ).toEqual([
      expect.objectContaining({
        type: "delegation_recovery",
        failureClass: "auth",
        madeProgress: false,
        cancelledDelegations: 2,
      }),
    ]);
    const delegateCalls = transcript.filter(
      (e) => e.type === "tool_call" && e.name === "delegate",
    );
    expect(delegateCalls.some((e) => e.status === "running")).toBe(false);
    expect(delegateCalls).toHaveLength(2);
    for (const call of delegateCalls) {
      expect(call).toMatchObject({
        status: "error",
        result: expect.objectContaining({
          status: "error",
          failureClass: "auth",
        }),
      });
    }
  });

  it("abandons the escalation and surfaces the failure when the cancel does not settle", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    let releaseRoot!: () => void;
    const rootHold = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    // A cancel that does not settle leaves the turn reporting an error instead
    // of `cancelled` — the shape `settleResult` produces when `wait()` rejects,
    // and the case where a resume would meet an agent that still has a live run.
    const unsettled = {
      id: FAKE_RUN_ID,
      status: "error" as const,
      error: { message: "run still active" },
    };
    const fake = createFakeAgentSdk({
      stream: [],
      sendScript: [
        { hold: rootHold, waitResult: unsettled },
        nestedAuthFailure(),
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Cancel never settles",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;

    const delegated = await delegate.execute(
      { role: DELEGATE_ROLE, prompt: "commit it" },
      { toolCallId: "call-delegate-auth" },
    );
    expect(delegated).toMatchObject({ ok: false, failureClass: "auth" });

    expect(await result.run.wait()).toEqual(unsettled);
    releaseRoot();

    const rootHandle = fake.handles.find(
      (handle) => handle.agentId === FAKE_AGENT_ID,
    );
    expect(rootHandle?.disposed).toBe(false);
    expect(fake.resumed).toHaveLength(0);
    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "status" && e.status === "RETRYING"),
    ).toHaveLength(0);
    expect(
      transcript.filter((e) => e.type === "delegation_recovery"),
    ).toHaveLength(0);
  });
});
