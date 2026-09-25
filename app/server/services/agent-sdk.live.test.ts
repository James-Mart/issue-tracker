import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  agentSdk,
  type AgentStreamEvent,
} from "./agent-sdk.js";

// Live SDK suite: authored and preserved, but excluded from the default
// `npm test` (which must never contact the SDK/network or spend tokens).
// Enabled only via `npm run test:live`, which sets `CURSOR_SDK_LIVE` and
// requires a real `CURSOR_API_KEY`.

/** A real turn outlives vitest's default per-test timeout many times over. */
const LIVE_TIMEOUT_MS = 300_000;

const STORE_DIR = join(process.cwd(), ".agent-state-test");

describe.skipIf(!process.env.CURSOR_SDK_LIVE)("agent-sdk (live)", () => {
  it("lists real models", async () => {
    const models = await agentSdk.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => typeof m.id === "string")).toBe(true);
  });

  it(
    "runs a prompt to completion through the merged stream",
    async () => {
      await using agent = await agentSdk.createAgent({
        cwd: process.cwd(),
        model: { id: "composer-2.5" },
        storeDir: STORE_DIR,
      });

      const run = await agent.send('Reply with the single word "pong".');
      const events: AgentStreamEvent[] = [];
      for await (const event of run) {
        events.push(event);
      }
      const result = await run.wait();

      expect(events.some((e) => e.kind === "message")).toBe(true);
      expect(result.status).toBe("finished");
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "steers a live run and observes the user stream message",
    async () => {
      await using agent = await agentSdk.createAgent({
        cwd: process.cwd(),
        model: { id: "composer-2.5" },
        storeDir: STORE_DIR,
      });

      const run = await agent.send(
        'Reply with exactly one word: "waiting". Then stop.',
      );
      const pump = (async () => {
        const events: AgentStreamEvent[] = [];
        for await (const event of run) {
          events.push(event);
        }
        return events;
      })();

      await new Promise((r) => setTimeout(r, 2000));

      const outcome = await run.steer('Reply with exactly one word: "steered".');
      expect(outcome).toBe("complete_delivered");

      const events = await pump;
      const userMessages = events.filter(
        (e) => e.kind === "message" && e.message.type === "user",
      );
      expect(
        userMessages.some(
          (e) =>
            e.kind === "message" &&
            e.message.type === "user" &&
            e.message.message.content.some(
              (block) =>
                block.type === "text" &&
                block.text.includes("steered"),
            ),
        ),
      ).toBe(true);

      const result = await run.wait();
      expect(["finished", "cancelled"]).toContain(result.status);
    },
    LIVE_TIMEOUT_MS,
  );
});
