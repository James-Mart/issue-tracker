import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedAgentModelSlug,
  resetAgentModelSlugsForTests,
} from "./agent-model-slugs.js";
import {
  MODEL_SLUG_CATALOG_TTL_MS,
  refreshAgentModelSlugCatalog,
  writeAgentModelSlugCatalog,
} from "./agent-model-slugs-sync.js";

let catalogRoots: string[] = [];

afterEach(() => {
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

describe("refreshAgentModelSlugCatalog", () => {
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
});
