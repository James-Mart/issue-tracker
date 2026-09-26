import { describe, expect, it } from "vitest";
import {
  buildAuthFailureStream,
  createFakeAgentSdk,
  FAKE_RUN_ID,
} from "./agent-sdk.fake.js";
import { load, useAgentSessionsTestFixtures } from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

const AUTH_ERROR_TEXT =
  "Authentication error. If you are logged in, try logging out and back in.";

/** A spawnable role the plugin ships, so the bridge finds a body and a pin. */
const DELEGATE_ROLE = "issue-tracker-research";

describe("delegation auth failure", () => {
  it("returns a retryable auth failure and leaves the parent turn running", async () => {
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
        {
          stream: buildAuthFailureStream(),
          waitResult: {
            id: "run-nested-auth",
            status: "error" as const,
            error: { message: AUTH_ERROR_TEXT, code: "AUTH_TOKEN_EXPIRED" },
          },
        },
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
    expect(delegated).toMatchObject({
      ok: false,
      failureClass: "auth",
      isRetryable: true,
      message: AUTH_ERROR_TEXT,
    });

    const rootHandle = fake.handles[0];
    expect(rootHandle?.cancelled).toBe(false);
    expect(rootHandle?.disposed).toBe(false);
    expect(rootHandle?.sends).toEqual([{ message: "go", options: {} }]);
    expect(sessions.getActiveRun(meta.id)?.id).toBe(FAKE_RUN_ID);
    expect(fake.resumed).toHaveLength(0);

    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "status" && e.status === "RETRYING"),
    ).toHaveLength(0);
    expect(
      transcript.filter((e) => e.type === "delegation_recovery"),
    ).toHaveLength(0);

    releaseRoot();
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "finished",
    });
    expect(rootHandle?.cancelled).toBe(false);
    expect(rootHandle?.sends).toHaveLength(1);
  });
});
