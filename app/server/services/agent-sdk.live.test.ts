import { describe, expect, it } from "vitest";
import { agentSdk, type AgentStreamEvent } from "./agent-sdk.js";

// Live SDK suite: authored and preserved, but excluded from the default
// `npm test` (which must never contact the SDK/network or spend tokens).
// Enabled only via `npm run test:live`, which sets `CURSOR_SDK_LIVE` and
// requires a real `CURSOR_API_KEY`.
describe.skipIf(!process.env.CURSOR_SDK_LIVE)("agent-sdk (live)", () => {
  it("lists real models", async () => {
    const models = await agentSdk.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => typeof m.id === "string")).toBe(true);
  });

  it("runs a prompt to completion through the merged stream", async () => {
    await using agent = await agentSdk.createAgent({
      cwd: process.cwd(),
      model: { id: "composer-2.5" },
    });

    const run = await agent.send('Reply with the single word "pong".');
    const events: AgentStreamEvent[] = [];
    for await (const event of run) {
      events.push(event);
    }
    const result = await run.wait();

    expect(events.some((e) => e.kind === "message")).toBe(true);
    expect(result.status).toBe("finished");
  });
});
