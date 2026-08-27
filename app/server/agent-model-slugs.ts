import { existsSync, readFileSync } from "fs";
import { FAKE_MODELS } from "./services/agent-sdk.fake.js";
import { modelSlugCatalogPath } from "./config.js";
import { IssueError } from "./services/errors.js";

export type AgentModelCatalogEntry = {
  id: string;
  displayName: string;
  [key: string]: unknown;
};

export type AgentModelCatalogFile = {
  fetchedAt: string;
  models: AgentModelCatalogEntry[];
};

/** Sync allowlist for agent model slug validation (schema + writes). */
let allowedSlugs = new Set(FAKE_MODELS.map((model) => model.id));
let loadedCatalogPath: string | undefined;

/** Test harness: skip live SDK sync in CLI subprocesses. */
export const SKIP_AGENT_MODEL_SLUG_SYNC_ENV = "ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC";

export function shouldSyncAgentModelSlugsFromSdk(): boolean {
  return process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV] !== "1";
}

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

function isUsableCatalog(
  catalog: AgentModelCatalogFile | null,
): catalog is AgentModelCatalogFile {
  return catalog !== null && catalog.models.length > 0;
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

export function markAgentModelSlugCatalogPathLoaded(catalogPath: string): void {
  loadedCatalogPath = catalogPath;
}

/** Load allowlist from on-disk catalog when usable; no SDK call. */
export function loadAgentModelSlugCatalogFromDisk(
  options: { catalogPath?: string } = {},
): void {
  const catalogPath = options.catalogPath ?? modelSlugCatalogPath;
  const disk = readAgentModelSlugCatalog(catalogPath);
  if (isUsableCatalog(disk)) {
    syncAgentModelSlugCatalog(disk.models);
  }
}

export function syncAgentModelSlugCatalog(
  models: readonly { id: string }[],
): void {
  configureAgentModelSlugs(models.map((model) => model.id));
}

export function configureAgentModelSlugs(slugs: readonly string[]): void {
  allowedSlugs = new Set(slugs);
}

export function resetAgentModelSlugsForTests(): void {
  allowedSlugs = new Set(FAKE_MODELS.map((model) => model.id));
  loadedCatalogPath = undefined;
}

export function isAllowedAgentModelSlug(slug: string): boolean {
  return allowedSlugs.has(slug);
}

export function assertAllowedAgentModelSlug(slug: string): void {
  const currentPath = modelSlugCatalogPath;
  if (loadedCatalogPath !== currentPath) {
    loadAgentModelSlugCatalogFromDisk({ catalogPath: currentPath });
    loadedCatalogPath = currentPath;
  }
  if (!isAllowedAgentModelSlug(slug)) {
    throw new IssueError(
      "validation",
      `unknown agent model slug "${slug}"`,
    );
  }
}
