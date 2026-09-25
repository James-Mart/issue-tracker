import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Agent } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import { cursorApiKey } from "../config.js";
import { agentSdk } from "./agent-sdk.js";
import { resolveModelSelection } from "./model-selection.js";

const LIVE_TIMEOUT_MS = 300_000;

describe.skipIf(!process.env.CURSOR_SDK_LIVE)(
  "Agent.getUsage live cost",
  () => {
    it(
      "reports cost after one local agent run",
      async () => {
        const storeDir = mkdtempSync(join(tmpdir(), "run-cost-live-"));
        await using agent = await agentSdk.createAgent({
          cwd: process.cwd(),
          model: resolveModelSelection("composer-2.5-fast"),
          storeDir,
        });

        const run = await agent.send('Reply with the single word "pong".');
        for await (const _event of run) {
          // drain stream before wait
        }
        const result = await run.wait();
        expect(result.status).toBe("finished");

        const usage = await Agent.getUsage(agent.agentId, {
          apiKey: cursorApiKey,
        });
        expect(usage.cost).toBeDefined();
        expect(typeof usage.cost?.rawCostCents).toBe("number");
        expect(typeof usage.cost?.chargedCents).toBe("number");
      },
      LIVE_TIMEOUT_MS,
    );
  },
);
