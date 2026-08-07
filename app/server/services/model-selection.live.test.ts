import type { SDKModel } from "@cursor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import { agentSdk } from "./agent-sdk.js";
import { resolveModelSelection } from "./model-selection.js";

// Live SDK suite: authored and preserved, but excluded from the default
// `npm test` (which must never contact the SDK/network or spend tokens).
// Enabled only via `npm run test:live`, which sets `CURSOR_SDK_LIVE` and
// requires a real `CURSOR_API_KEY`. This one only reads the model catalog, so
// it spends no tokens.

/**
 * `resolveModelSelection` is checked here against the catalog rather than only
 * against its own literals, because the SDK validates nothing inside `params`:
 * an id or value the backend has dropped is accepted in silence and the role
 * runs at the model's defaults. `run.model` cannot expose that either — it
 * echoes the selection that was requested. Drift in the catalog is therefore
 * invisible everywhere except a test that asks the catalog.
 */

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
  "resolveModelSelection against the live catalog",
  () => {
    let catalog: SDKModel[];

    beforeAll(async () => {
      catalog = await agentSdk.listModels();
      expect(catalog.length).toBeGreaterThan(0);
    });

    it("finds a pin for every spawnable role", () => {
      expect(PINS.length).toBeGreaterThan(0);
    });

    for (const pin of PINS) {
      it(`resolves ${pin} to a selection the catalog still advertises`, () => {
        const selection = resolveModelSelection(pin);

        const model = catalog.find(
          (candidate) =>
            candidate.id === selection.id ||
            candidate.aliases?.includes(selection.id),
        );
        expect(
          model,
          `${pin} resolves to model id "${selection.id}", which the catalog does not list. Catalog ids: ${catalog
            .map((m) => m.id)
            .join(", ")}`,
        ).toBeDefined();

        for (const param of selection.params ?? []) {
          const definition = model!.parameters?.find(
            (candidate) => candidate.id === param.id,
          );
          expect(
            definition,
            `${pin} sends parameter "${param.id}", which ${model!.id} does not accept. Accepted: ${
              model!.parameters?.map((p) => p.id).join(", ") ?? "none"
            }`,
          ).toBeDefined();

          expect(
            definition!.values.map((choice) => choice.value),
            `${pin} sends ${param.id}="${param.value}", which ${model!.id} does not accept`,
          ).toContain(param.value);
        }
      });
    }
  },
);
