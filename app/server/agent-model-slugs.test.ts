import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAllowedAgentModelSlug,
  configureAgentModelSlugs,
  isAllowedAgentModelSlug,
  loadAgentModelSlugCatalogFromDisk,
  resetAgentModelSlugsForTests,
  shouldSyncAgentModelSlugsFromSdk,
  SKIP_AGENT_MODEL_SLUG_SYNC_ENV,
  syncAgentModelSlugCatalog,
} from "./agent-model-slugs.js";
import {
  MODEL_SLUG_CATALOG_TTL_MS,
  refreshAgentModelSlugCatalog,
  writeAgentModelSlugCatalog,
} from "./agent-model-slugs-sync.js";
import { modelSlugCatalogPath, refreshStorePathsFromEnv } from "./config.js";

let catalogRoots: string[] = [];
let savedIssuesDir: string | undefined;

afterEach(() => {
  delete process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV];
  if (savedIssuesDir === undefined) {
    delete process.env.ISSUES_DIR;
  } else {
    process.env.ISSUES_DIR = savedIssuesDir;
  }
  savedIssuesDir = undefined;
  refreshStorePathsFromEnv();
  resetAgentModelSlugsForTests();
  for (const root of catalogRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  catalogRoots = [];
});

function tempCatalogPath(): string {
  const root = mkdtempSync(join(tmpdir(), "model-slug-catalog-"));
  catalogRoots.push(root);
  return join(root, "model-slug-catalog.json");
}

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

describe("loadAgentModelSlugCatalogFromDisk", () => {
  it("loads a usable on-disk catalog without refreshAgentModelSlugCatalog", () => {
    savedIssuesDir = process.env.ISSUES_DIR;
    const store = mkdtempSync(join(tmpdir(), "model-slug-catalog-"));
    catalogRoots.push(store);
    const issuesDir = join(store, "issues");
    mkdirSync(issuesDir, { recursive: true });
    process.env.ISSUES_DIR = issuesDir;
    refreshStorePathsFromEnv();
    writeAgentModelSlugCatalog(modelSlugCatalogPath, [
      { id: "disk-only", displayName: "Disk Only" },
    ]);
    expect(() => assertAllowedAgentModelSlug("disk-only")).not.toThrow();
    expect(() => assertAllowedAgentModelSlug("not-in-catalog")).toThrow(
      /unknown agent model slug/,
    );
  });

  it("leaves FAKE_MODELS when the catalog file is missing", () => {
    const catalogPath = tempCatalogPath();
    loadAgentModelSlugCatalogFromDisk({ catalogPath });
    expect(isAllowedAgentModelSlug("composer-2.5")).toBe(true);
    expect(isAllowedAgentModelSlug("auto")).toBe(true);
    expect(isAllowedAgentModelSlug("disk-only")).toBe(false);
  });

  it("leaves FAKE_MODELS when the catalog file is empty", () => {
    const catalogPath = tempCatalogPath();
    writeAgentModelSlugCatalog(catalogPath, []);
    loadAgentModelSlugCatalogFromDisk({ catalogPath });
    expect(isAllowedAgentModelSlug("composer-2.5")).toBe(true);
    expect(isAllowedAgentModelSlug("auto")).toBe(true);
  });

  it("reloads from the new store after refreshStorePathsFromEnv", () => {
    savedIssuesDir = process.env.ISSUES_DIR;
    const storeOne = mkdtempSync(join(tmpdir(), "issues-store-one-"));
    const storeTwo = mkdtempSync(join(tmpdir(), "issues-store-two-"));
    catalogRoots.push(storeOne, storeTwo);

    const issuesDirOne = join(storeOne, "issues");
    mkdirSync(issuesDirOne, { recursive: true });
    process.env.ISSUES_DIR = issuesDirOne;
    refreshStorePathsFromEnv();
    writeAgentModelSlugCatalog(modelSlugCatalogPath, [
      { id: "store-one-slug", displayName: "Store One" },
    ]);
    expect(() => assertAllowedAgentModelSlug("store-one-slug")).not.toThrow();

    const issuesDirTwo = join(storeTwo, "issues");
    mkdirSync(issuesDirTwo, { recursive: true });
    process.env.ISSUES_DIR = issuesDirTwo;
    refreshStorePathsFromEnv();
    writeAgentModelSlugCatalog(modelSlugCatalogPath, [
      { id: "store-two-slug", displayName: "Store Two" },
    ]);
    expect(() => assertAllowedAgentModelSlug("store-two-slug")).not.toThrow();
    expect(() => assertAllowedAgentModelSlug("store-one-slug")).toThrow(
      /unknown agent model slug/,
    );
  });
});

describe("refreshAgentModelSlugCatalog", () => {
  it("loads a fresh on-disk catalog without calling listModels", async () => {
    const catalogPath = tempCatalogPath();
    const fetchedAt = new Date("2026-08-11T12:00:00.000Z").toISOString();
    writeAgentModelSlugCatalog(
      catalogPath,
      [
        { id: "disk-fresh", displayName: "Disk Fresh" },
        { id: "disk-two", displayName: "Disk Two" },
      ],
      fetchedAt,
    );
    let listCalls = 0;
    await refreshAgentModelSlugCatalog({
      catalogPath,
      now: () => Date.parse(fetchedAt) + 1_000,
      sdk: {
        listModels: async () => {
          listCalls += 1;
          return [{ id: "live", displayName: "Live" }];
        },
      },
    });
    expect(listCalls).toBe(0);
    expect(isAllowedAgentModelSlug("disk-fresh")).toBe(true);
    expect(isAllowedAgentModelSlug("disk-two")).toBe(true);
    expect(isAllowedAgentModelSlug("live")).toBe(false);
  });

  it("refreshes and rewrites when the catalog is missing", async () => {
    const catalogPath = tempCatalogPath();
    const nowMs = Date.parse("2026-08-11T15:00:00.000Z");
    await refreshAgentModelSlugCatalog({
      catalogPath,
      now: () => nowMs,
      sdk: {
        listModels: async () => [
          { id: "grok-4.5", displayName: "Grok 4.5" },
          { id: "default", displayName: "Default" },
        ],
      },
    });
    expect(isAllowedAgentModelSlug("grok-4.5")).toBe(true);
    expect(isAllowedAgentModelSlug("default")).toBe(true);
    const written = JSON.parse(readFileSync(catalogPath, "utf8"));
    expect(written.fetchedAt).toBe(new Date(nowMs).toISOString());
    expect(written.models).toEqual([
      { id: "grok-4.5", displayName: "Grok 4.5" },
      { id: "default", displayName: "Default" },
    ]);
  });

  it("refreshes and rewrites when the catalog is past TTL", async () => {
    const catalogPath = tempCatalogPath();
    const fetchedAt = new Date("2026-08-11T12:00:00.000Z").toISOString();
    writeAgentModelSlugCatalog(
      catalogPath,
      [{ id: "stale-model", displayName: "Stale" }],
      fetchedAt,
    );
    const nowMs = Date.parse(fetchedAt) + MODEL_SLUG_CATALOG_TTL_MS + 1;
    await refreshAgentModelSlugCatalog({
      catalogPath,
      now: () => nowMs,
      sdk: {
        listModels: async () => [
          { id: "fresh-model", displayName: "Fresh" },
        ],
      },
    });
    expect(isAllowedAgentModelSlug("fresh-model")).toBe(true);
    expect(isAllowedAgentModelSlug("stale-model")).toBe(false);
    const written = JSON.parse(readFileSync(catalogPath, "utf8"));
    expect(written.fetchedAt).toBe(new Date(nowMs).toISOString());
    expect(written.models).toEqual([
      { id: "fresh-model", displayName: "Fresh" },
    ]);
  });

  it("keeps usable stale disk when listModels fails", async () => {
    const catalogPath = tempCatalogPath();
    const fetchedAt = new Date("2026-08-11T12:00:00.000Z").toISOString();
    writeAgentModelSlugCatalog(
      catalogPath,
      [{ id: "stale-keep", displayName: "Keep" }],
      fetchedAt,
    );
    const before = readFileSync(catalogPath, "utf8");
    await refreshAgentModelSlugCatalog({
      catalogPath,
      now: () => Date.parse(fetchedAt) + MODEL_SLUG_CATALOG_TTL_MS + 1,
      sdk: {
        listModels: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(isAllowedAgentModelSlug("stale-keep")).toBe(true);
    expect(readFileSync(catalogPath, "utf8")).toBe(before);
  });

  it("keeps usable stale disk when listModels returns empty", async () => {
    const catalogPath = tempCatalogPath();
    const fetchedAt = new Date("2026-08-11T12:00:00.000Z").toISOString();
    writeAgentModelSlugCatalog(
      catalogPath,
      [{ id: "stale-empty", displayName: "Keep" }],
      fetchedAt,
    );
    await refreshAgentModelSlugCatalog({
      catalogPath,
      now: () => Date.parse(fetchedAt) + MODEL_SLUG_CATALOG_TTL_MS + 1,
      sdk: { listModels: async () => [] },
    });
    expect(isAllowedAgentModelSlug("stale-empty")).toBe(true);
  });

  it("fails loud when there is no usable cache and sync fails", async () => {
    const catalogPath = tempCatalogPath();
    await expect(
      refreshAgentModelSlugCatalog({
        catalogPath,
        sdk: {
          listModels: async () => {
            throw new Error("offline");
          },
        },
      }),
    ).rejects.toThrow(/no usable on-disk catalog/);
    expect(existsSync(catalogPath)).toBe(false);
  });

  it("fails loud when there is no usable cache and listModels is empty", async () => {
    const catalogPath = tempCatalogPath();
    writeFileSync(catalogPath, "{not-json");
    await expect(
      refreshAgentModelSlugCatalog({
        catalogPath,
        sdk: { listModels: async () => [] },
      }),
    ).rejects.toThrow(/no usable on-disk catalog/);
  });

  it("honors ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC without touching disk", async () => {
    process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV] = "1";
    const catalogPath = tempCatalogPath();
    writeAgentModelSlugCatalog(catalogPath, [
      { id: "disk-model", displayName: "Disk" },
    ]);
    const before = readFileSync(catalogPath, "utf8");
    configureAgentModelSlugs(["kept"]);
    let listCalls = 0;
    await refreshAgentModelSlugCatalog({
      catalogPath,
      sdk: {
        listModels: async () => {
          listCalls += 1;
          return [{ id: "grok-4.5", displayName: "Grok" }];
        },
      },
    });
    expect(listCalls).toBe(0);
    expect(isAllowedAgentModelSlug("kept")).toBe(true);
    expect(isAllowedAgentModelSlug("grok-4.5")).toBe(false);
    expect(isAllowedAgentModelSlug("disk-model")).toBe(false);
    expect(shouldSyncAgentModelSlugsFromSdk()).toBe(false);
    expect(readFileSync(catalogPath, "utf8")).toBe(before);
  });
});
