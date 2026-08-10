import {
  shouldSyncAgentModelSlugsFromSdk,
  syncAgentModelSlugCatalog,
} from "./agent-model-slugs.js";
import type { AgentSdk } from "./services/agent-sdk.js";
import { agentSdk } from "./services/agent-sdk.js";

/** Load ids from the SDK catalog; keep bootstrap allowlist when sync is skipped or fails. */
export async function refreshAgentModelSlugsFromSdk(
  sdk: Pick<AgentSdk, "listModels"> = agentSdk,
): Promise<void> {
  if (!shouldSyncAgentModelSlugsFromSdk()) return;
  try {
    const models = await sdk.listModels();
    if (models.length > 0) {
      syncAgentModelSlugCatalog(models);
    }
  } catch {
    // Offline or misconfigured — retain the bootstrap allowlist.
  }
}
