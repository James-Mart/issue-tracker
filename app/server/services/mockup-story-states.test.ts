import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtureIndex = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/storybook-index.json"),
    "utf8",
  ),
);

const baseUrl = "http://127.0.0.1:41005";
const indexUrl = `${baseUrl}/index.json`;

function mockIndex(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== indexUrl) {
        throw new Error(`unexpected fetch url: ${url}`);
      }
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => body,
      } as Response;
    }),
  );
}

async function loadService() {
  return import("./mockup-story-states.js");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listStoryStates", () => {
  it("maps story entries to StoryState", async () => {
    mockIndex(fixtureIndex);
    const { listStoryStates } = await loadService();

    const states = await listStoryStates(baseUrl);

    expect(states).toEqual([
      {
        id: "direction-a-card--default",
        title: "direction-a/Card",
        name: "Default",
      },
      {
        id: "direction-a-card--hover",
        title: "direction-a/Card",
        name: "Hover",
      },
      {
        id: "direction-a-header--default",
        title: "direction-a/Header",
        name: "Default",
      },
      {
        id: "direction-ab-panel--default",
        title: "direction-ab/Panel",
        name: "Default",
      },
      {
        id: "direction-b-list--default",
        title: "direction-b/List",
        name: "Default",
      },
    ]);
  });

  it("narrows entries to a direction prefix", async () => {
    mockIndex(fixtureIndex);
    const { listStoryStates } = await loadService();

    const states = await listStoryStates(baseUrl, "direction-a");

    expect(states.map((state) => state.id).sort()).toEqual([
      "direction-a-card--default",
      "direction-a-card--hover",
      "direction-a-header--default",
    ]);
  });

  it("does not capture another direction when its id is a prefix", async () => {
    mockIndex(fixtureIndex);
    const { listStoryStates } = await loadService();

    const states = await listStoryStates(baseUrl, "direction-a");

    expect(states.some((state) => state.title.startsWith("direction-ab/"))).toBe(
      false,
    );
  });

  it("throws for an unknown direction", async () => {
    mockIndex(fixtureIndex);
    const { listStoryStates } = await loadService();

    await expect(listStoryStates(baseUrl, "direction-missing")).rejects.toThrow(
      'no story states for direction "direction-missing"',
    );
  });

  it("throws for an unparseable index", async () => {
    mockIndex({ v: 5, entries: { bad: { id: "", title: "x", name: "y", type: "story" } } });
    const { listStoryStates } = await loadService();

    await expect(listStoryStates(baseUrl)).rejects.toThrow(
      `unparseable story index at ${indexUrl}:`,
    );
  });

  it("throws when the index cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const { listStoryStates } = await loadService();

    await expect(listStoryStates(baseUrl)).rejects.toThrow(
      `failed to fetch story index from ${indexUrl}: connection refused`,
    );
  });

  it("throws when the index response is not ok", async () => {
    mockIndex({}, false);
    const { listStoryStates } = await loadService();

    await expect(listStoryStates(baseUrl)).rejects.toThrow(
      `failed to fetch story index from ${indexUrl}: status 503`,
    );
  });
});
