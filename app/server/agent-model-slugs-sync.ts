import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  markAgentModelSlugCatalogPathLoaded,
  readAgentModelSlugCatalog,
  shouldSyncAgentModelSlugsFromSdk,
  syncAgentModelSlugCatalog,
  type AgentModelCatalogEntry,
  type AgentModelCatalogFile,
} from "./agent-model-slugs.js";
import { modelSlugCatalogPath } from "./config.js";
import type { AgentSdk } from "./services/agent-sdk.js";
import { agentSdk, CursorAgentError } from "./services/agent-sdk.js";

export type { AgentModelCatalogEntry, AgentModelCatalogFile };

/** Story freshness window for the on-disk SDK model catalog. */
export const MODEL_SLUG_CATALOG_TTL_MS = 60 * 60 * 1000;

export type RefreshAgentModelSlugCatalogOptions = {
  sdk?: Pick<AgentSdk, "listModels">;
  catalogPath?: string;
  now?: () => number;
  ttlMs?: number;
};

function isUsableCatalog(
  catalog: AgentModelCatalogFile | null,
): catalog is AgentModelCatalogFile {
  return catalog !== null && catalog.models.length > 0;
}

function isFreshCatalog(
  catalog: AgentModelCatalogFile,
  nowMs: number,
  ttlMs: number,
): boolean {
  const fetchedMs = Date.parse(catalog.fetchedAt);
  if (Number.isNaN(fetchedMs)) return false;
  return nowMs - fetchedMs < ttlMs;
}

export function writeAgentModelSlugCatalog(
  catalogPath: string,
  models: readonly AgentModelCatalogEntry[],
  fetchedAt: string = new Date().toISOString(),
): void {
  mkdirSync(dirname(catalogPath), { recursive: true });
  const body: AgentModelCatalogFile = { fetchedAt, models: [...models] };
  writeFileSync(catalogPath, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Load the allowlist from a fresh on-disk catalog, or refresh via `listModels`
 * when the file is missing/stale. Keeps a usable stale file when refresh fails;
 * fails loud only when there is no usable on-disk catalog.
 *
 * Returns the catalog models so HTTP can serve `{ models }` without a second
 * live call. Returns `null` when sync is skipped via env.
 */
export async function refreshAgentModelSlugCatalog(
  options: RefreshAgentModelSlugCatalogOptions = {},
): Promise<AgentModelCatalogEntry[] | null> {
  if (!shouldSyncAgentModelSlugsFromSdk()) return null;

  const sdk = options.sdk ?? agentSdk;
  const catalogPath = options.catalogPath ?? modelSlugCatalogPath;
  const nowMs = (options.now ?? Date.now)();
  const ttlMs = options.ttlMs ?? MODEL_SLUG_CATALOG_TTL_MS;
  const disk = readAgentModelSlugCatalog(catalogPath);

  if (isUsableCatalog(disk) && isFreshCatalog(disk, nowMs, ttlMs)) {
    syncAgentModelSlugCatalog(disk.models);
    markAgentModelSlugCatalogPathLoaded(catalogPath);
    return disk.models;
  }

  let refreshError: unknown;
  try {
    const models = await sdk.listModels();
    if (models.length > 0) {
      writeAgentModelSlugCatalog(
        catalogPath,
        models,
        new Date(nowMs).toISOString(),
      );
      syncAgentModelSlugCatalog(models);
      markAgentModelSlugCatalogPathLoaded(catalogPath);
      return models;
    }
  } catch (err) {
    // Refresh failed — fall through to usable stale disk, else fail loud.
    refreshError = err;
  }

  if (isUsableCatalog(disk)) {
    syncAgentModelSlugCatalog(disk.models);
    markAgentModelSlugCatalogPathLoaded(catalogPath);
    return disk.models;
  }

  if (refreshError instanceof CursorAgentError) {
    throw refreshError;
  }

  throw new Error(
    `agent model slug catalog unavailable at ${catalogPath}: listModels failed or returned no models and no usable on-disk catalog`,
  );
}
