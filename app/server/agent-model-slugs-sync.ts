import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  shouldSyncAgentModelSlugsFromSdk,
  syncAgentModelSlugCatalog,
} from "./agent-model-slugs.js";
import { modelSlugCatalogPath } from "./config.js";
import type { AgentSdk } from "./services/agent-sdk.js";
import { agentSdk } from "./services/agent-sdk.js";

/** Story freshness window for the on-disk SDK model catalog. */
export const MODEL_SLUG_CATALOG_TTL_MS = 60 * 60 * 1000;

export type AgentModelCatalogEntry = {
  id: string;
  displayName: string;
  [key: string]: unknown;
};

export type AgentModelCatalogFile = {
  fetchedAt: string;
  models: AgentModelCatalogEntry[];
};

export type RefreshAgentModelSlugCatalogOptions = {
  sdk?: Pick<AgentSdk, "listModels">;
  catalogPath?: string;
  now?: () => number;
  ttlMs?: number;
};

function isCatalogEntry(value: unknown): value is AgentModelCatalogEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && typeof entry.displayName === "string";
}

function parseCatalog(raw: unknown): AgentModelCatalogFile | null {
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.fetchedAt !== "string" || !Array.isArray(body.models)) {
    return null;
  }
  if (!body.models.every(isCatalogEntry)) return null;
  return { fetchedAt: body.fetchedAt, models: body.models };
}

export function readAgentModelSlugCatalog(
  catalogPath: string,
): AgentModelCatalogFile | null {
  if (!existsSync(catalogPath)) return null;
  try {
    return parseCatalog(JSON.parse(readFileSync(catalogPath, "utf8")));
  } catch {
    return null;
  }
}

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
 */
export async function refreshAgentModelSlugCatalog(
  options: RefreshAgentModelSlugCatalogOptions = {},
): Promise<void> {
  if (!shouldSyncAgentModelSlugsFromSdk()) return;

  const sdk = options.sdk ?? agentSdk;
  const catalogPath = options.catalogPath ?? modelSlugCatalogPath;
  const nowMs = (options.now ?? Date.now)();
  const ttlMs = options.ttlMs ?? MODEL_SLUG_CATALOG_TTL_MS;
  const disk = readAgentModelSlugCatalog(catalogPath);

  if (isUsableCatalog(disk) && isFreshCatalog(disk, nowMs, ttlMs)) {
    syncAgentModelSlugCatalog(disk.models);
    return;
  }

  try {
    const models = await sdk.listModels();
    if (models.length > 0) {
      writeAgentModelSlugCatalog(
        catalogPath,
        models,
        new Date(nowMs).toISOString(),
      );
      syncAgentModelSlugCatalog(models);
      return;
    }
  } catch {
    // Refresh failed — fall through to usable stale disk, else fail loud.
  }

  if (isUsableCatalog(disk)) {
    syncAgentModelSlugCatalog(disk.models);
    return;
  }

  throw new Error(
    `agent model slug catalog unavailable at ${catalogPath}: listModels failed or returned no models and no usable on-disk catalog`,
  );
}
