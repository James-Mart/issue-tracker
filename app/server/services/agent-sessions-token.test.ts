import { describe, expect, it } from "vitest";
import { createFakeAgentSdk, FAKE_RUN_ID } from "./agent-sdk.fake.js";
import { load, useAgentSessionsTestFixtures } from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

describe("expired access token recovery", () => {
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
});
