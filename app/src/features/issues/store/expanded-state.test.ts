import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPANDED_KEY,
  EXPANDED_VERSION,
  EXPANDED_VERSION_KEY,
  ensureBoardRootsExpandedOnce,
  expandedMigrationDone,
  loadExpanded,
  resolveExpanded,
  saveExpanded,
  toggleExpanded,
} from "./expanded-state";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    values,
  };
}

describe("expanded-state", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads old collapsed-only JSON and ignores non-false values", () => {
    storage.setItem(
      EXPANDED_KEY,
      JSON.stringify({ "epic-a": false, "epic-b": true, "epic-c": "nope" }),
    );

    expect(loadExpanded(storage)).toEqual({ "epic-a": false });
  });

  it("loads explicit true entries once the v2 version key is set", () => {
    storage.setItem(EXPANDED_VERSION_KEY, EXPANDED_VERSION);
    storage.setItem(
      EXPANDED_KEY,
      JSON.stringify({ root: true, nested: false }),
    );

    expect(loadExpanded(storage)).toEqual({ root: true, nested: false });
  });

  it("resolves a missing board-root key as collapsed", () => {
    expect(resolveExpanded({}, "epic-a", false)).toBe(false);
  });

  it("resolves a missing nested key as expanded", () => {
    expect(resolveExpanded({}, "story-a", true)).toBe(true);
  });

  it("prefers an explicit stored value over the row fallback", () => {
    expect(resolveExpanded({ "epic-a": true }, "epic-a", false)).toBe(true);
    expect(resolveExpanded({ "story-a": false }, "story-a", true)).toBe(false);
  });

  it("toggles a board root from collapsed to persisted true", () => {
    const next = toggleExpanded({}, "epic-a", false);
    expect(next).toEqual({ "epic-a": true });
    saveExpanded(next, storage);
    expect(JSON.parse(storage.values.get(EXPANDED_KEY)!)).toEqual({
      "epic-a": true,
    });
  });

  it("toggles a nested row from expanded to persisted false", () => {
    const next = toggleExpanded({}, "story-a", true);
    expect(next).toEqual({ "story-a": false });
  });

  it("one-shot fill writes true for board roots without entries", () => {
    storage.setItem(EXPANDED_KEY, JSON.stringify({ "epic-old": false }));

    const next = ensureBoardRootsExpandedOnce(
      loadExpanded(storage),
      ["epic-a", "idea-b", "story-c"],
      storage,
    );

    expect(next).toEqual({
      "epic-old": false,
      "epic-a": true,
      "idea-b": true,
      "story-c": true,
    });
    expect(storage.values.get(EXPANDED_VERSION_KEY)).toBe(EXPANDED_VERSION);
    expect(JSON.parse(storage.values.get(EXPANDED_KEY)!)).toEqual(next);
  });

  it("does not run the one-shot fill again once version is 2", () => {
    storage.setItem(EXPANDED_VERSION_KEY, EXPANDED_VERSION);

    const next = ensureBoardRootsExpandedOnce({}, ["epic-new"], storage);

    expect(next).toEqual({});
    expect(storage.values.has(EXPANDED_KEY)).toBe(false);
  });

  it("does not overwrite explicit entries during the one-shot fill", () => {
    const next = ensureBoardRootsExpandedOnce(
      { "epic-a": false },
      ["epic-a", "epic-b"],
      storage,
    );

    expect(next).toEqual({ "epic-a": false, "epic-b": true });
  });

  it("reports migration completion from the version key", () => {
    expect(expandedMigrationDone(storage)).toBe(false);
    storage.setItem(EXPANDED_VERSION_KEY, EXPANDED_VERSION);
    expect(expandedMigrationDone(storage)).toBe(true);
  });
});

describe("useIssueUiStore expanded slice", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadStore() {
    const { useIssueUiStore } = await import("./use-issue-ui-store");
    return useIssueUiStore;
  }

  it("persists both expanded and collapsed ids through toggle", async () => {
    const useIssueUiStore = await loadStore();

    useIssueUiStore.getState().toggle("epic-a", false);
    expect(useIssueUiStore.getState().expanded).toEqual({ "epic-a": true });

    useIssueUiStore.getState().toggle("story-nested", true);
    expect(useIssueUiStore.getState().expanded).toEqual({
      "epic-a": true,
      "story-nested": false,
    });
    expect(JSON.parse(storage.values.get(EXPANDED_KEY)!)).toEqual({
      "epic-a": true,
      "story-nested": false,
    });
  });

  it("updates store state when the one-shot fill runs", async () => {
    const useIssueUiStore = await loadStore();

    useIssueUiStore.getState().ensureBoardRootsExpandedOnce(["epic-a"]);

    expect(useIssueUiStore.getState().expanded).toEqual({ "epic-a": true });
    expect(storage.values.get(EXPANDED_VERSION_KEY)).toBe(EXPANDED_VERSION);
  });
});
