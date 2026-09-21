import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import { agentSdk } from "./agent-sdk.js";
import { resolveModelSelection } from "./model-selection.js";

// Live SDK suite: authored and preserved, but excluded from the default
// `npm test` (which must never contact the SDK/network or spend tokens).
// Enabled only via `npm run test:live`, which sets `CURSOR_SDK_LIVE` and
// requires a real `CURSOR_API_KEY`.

/** A real turn outlives vitest's default per-test timeout many times over. */
const LIVE_TIMEOUT_MS = 300_000;

/** Every pin the plugin's spawnable roles actually carry. */
function pinsInUse(): string[] {
  const pins = new Set<string>();
  for (const definition of Object.values(loadPluginAgentDefinitions())) {
    const model = definition.model;
    if (model && model !== "inherit") pins.add(model.id);
  }
  return [...pins].sort();
}

const PINS = pinsInUse();

describe.skipIf(!process.env.CURSOR_SDK_LIVE)(
  "resolveModelSelection live runs",
  () => {
    it("finds a pin for every spawnable role", () => {
      expect(PINS.length).toBeGreaterThan(0);
    });

    for (const pin of PINS) {
      it(
        `runs to completion with ${pin}`,
        async () => {
          const storeDir = mkdtempSync(
            join(tmpdir(), `model-selection-run-${pin}-`),
          );
          await using agent = await agentSdk.createAgent({
            cwd: process.cwd(),
            model: resolveModelSelection(pin),
            storeDir,
          });

          const run = await agent.send('Reply with the single word "pong".');
          for await (const _event of run) {
            // drain stream before wait
          }
          const result = await run.wait();

          expect(result.status).toBe("finished");
        },
        LIVE_TIMEOUT_MS,
      );
    }
  },
);
