import { afterEach, describe, expect, it } from "vitest";
import {
  configureAgentModelSlugs,
  isAllowedAgentModelSlug,
  resetAgentModelSlugsForTests,
  shouldSyncAgentModelSlugsFromSdk,
  SKIP_AGENT_MODEL_SLUG_SYNC_ENV,
  syncAgentModelSlugCatalog,
} from "./agent-model-slugs.js";
import { refreshAgentModelSlugsFromSdk } from "./agent-model-slugs-sync.js";

afterEach(() => {
  delete process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV];
  resetAgentModelSlugsForTests();
});

describe("syncAgentModelSlugCatalog", () => {
  it("accepts ids from the SDK catalog", () => {
    syncAgentModelSlugCatalog([
      { id: "grok-4.5" },
      { id: "default" },
    ]);
    expect(isAllowedAgentModelSlug("grok-4.5")).toBe(true);
    expect(isAllowedAgentModelSlug("default")).toBe(true);
    expect(isAllowedAgentModelSlug("composer-2.5")).toBe(false);
  });
});

describe("refreshAgentModelSlugsFromSdk", () => {
  it("loads ids from listModels", async () => {
    await refreshAgentModelSlugsFromSdk({
      listModels: async () => [
        { id: "grok-4.5", displayName: "Grok 4.5" },
        { id: "default", displayName: "Default" },
      ],
    });
    expect(isAllowedAgentModelSlug("grok-4.5")).toBe(true);
    expect(isAllowedAgentModelSlug("default")).toBe(true);
  });

  it("keeps the bootstrap allowlist when listModels fails", async () => {
    configureAgentModelSlugs(["only-bootstrap"]);
    await refreshAgentModelSlugsFromSdk({
      listModels: async () => {
        throw new Error("offline");
      },
    });
    expect(isAllowedAgentModelSlug("only-bootstrap")).toBe(true);
  });

  it("honors ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC", async () => {
    process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV] = "1";
    configureAgentModelSlugs(["kept"]);
    await refreshAgentModelSlugsFromSdk({
      listModels: async () => [{ id: "grok-4.5", displayName: "Grok" }],
    });
    expect(isAllowedAgentModelSlug("kept")).toBe(true);
    expect(isAllowedAgentModelSlug("grok-4.5")).toBe(false);
    expect(shouldSyncAgentModelSlugsFromSdk()).toBe(false);
  });
});
