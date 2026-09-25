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
const conversationId = "my-conversation";

function mockIndex(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== indexUrl) {
        throw new Error(`unexpected fetch url: ${url}`);
      }
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }),
  );
}

async function loadService() {
  return import("./mockup-live-storybook.js");
}

async function loadStoryStates() {
  return import("./mockup-story-states.js");
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("./mockup-scratch.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./mockup-scratch.js")>();
    return {
      ...original,
      resolveMockupConversationId: (id: string) => id,
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chooseLiveStoryForDirection", () => {
  it("chooses the first Default story in title/name order", async () => {
    const { chooseLiveStoryForDirection } = await loadStoryStates();
    const story = chooseLiveStoryForDirection([
      {
        id: "direction-a-header--default",
        title: "direction-a/Header",
        name: "Default",
      },
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
    ]);

    expect(story.id).toBe("direction-a-card--default");
  });

  it("chooses the first listed story when no Default exists", async () => {
    const { chooseLiveStoryForDirection } = await loadStoryStates();
    const story = chooseLiveStoryForDirection([
      {
        id: "direction-c-page--wide",
        title: "direction-c/Page",
        name: "Wide",
      },
      {
        id: "direction-c-page--compact",
        title: "direction-c/Page",
        name: "Compact",
      },
    ]);

    expect(story.id).toBe("direction-c-page--compact");
  });
});

describe("liveStorybookHref", () => {
  it("uses the public mockup prefix, nav=0, and no loopback host", async () => {
    const { liveStorybookHref, liveStorybookLinkMarkdown } = await loadService();

    const href = liveStorybookHref(conversationId, "direction-a-card--default");
    expect(href).toBe(
      "/mockups/my-conversation/?path=%2Fstory%2Fdirection-a-card--default&nav=0",
    );
    expect(href).toContain("nav=0");
    expect(href).not.toContain("127.0.0.1");

    expect(liveStorybookLinkMarkdown(conversationId, "direction-a-card--default")).toBe(
      `[Open live Storybook](${href})`,
    );
  });
});

describe("resolveLiveStorybookLink", () => {
  it("links a direction with a Default story to that story", async () => {
    mockIndex(fixtureIndex);
    const { resolveLiveStorybookLink } = await loadService();

    const link = await resolveLiveStorybookLink(
      conversationId,
      "direction-a",
      baseUrl,
    );

    expect(link.storyId).toBe("direction-a-card--default");
    expect(link.href).toContain("nav=0");
    expect(link.href).not.toContain("127.0.0.1");
    expect(link.markdown).toBe(`[Open live Storybook](${link.href})`);
  });

  it("links a direction without Default to its first listed story", async () => {
    mockIndex({
      v: 5,
      entries: {
        "direction-c-page--wide": {
          id: "direction-c-page--wide",
          title: "direction-c/Page",
          name: "Wide",
          type: "story",
        },
        "direction-c-page--compact": {
          id: "direction-c-page--compact",
          title: "direction-c/Page",
          name: "Compact",
          type: "story",
        },
      },
    });
    const { resolveLiveStorybookLink } = await loadService();

    const link = await resolveLiveStorybookLink(
      conversationId,
      "direction-c",
      baseUrl,
    );

    expect(link.storyId).toBe("direction-c-page--compact");
  });
});
