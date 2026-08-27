import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appDir } from "../config.js";
import type { StoryState } from "./mockup-story-states.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let root: string;
let issuesDir: string;
let outDir: string;
let server: Server | null = null;
let baseUrl = "";

const directionAStates: StoryState[] = [
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
];

function iframeHtml(storyId: string): string {
  return `<!DOCTYPE html>
<html>
  <body>
    <div id="storybook-root" data-story-id="${storyId}" style="width:200px;height:80px;background:#3366cc;color:white;display:flex;align-items:center;justify-content:center;font-family:sans-serif">
      ${storyId}
    </div>
  </body>
</html>`;
}

async function startFixtureServer(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", baseUrl || "http://127.0.0.1");
    if (url.pathname === "/iframe.html") {
      const storyId = url.searchParams.get("id") ?? "unknown";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(iframeHtml(storyId));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server!.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server has no port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopFixtureServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
}

async function loadCapture() {
  return import("./mockup-story-capture.js");
}

async function loadStoryStates() {
  return import("./mockup-story-states.js");
}

async function loadScratch() {
  return import("./mockup-scratch.js");
}

async function loadStack() {
  return import("./mockup-stack.js");
}

async function loadConfig() {
  return import("../config.js");
}

function writeConversationMeta(
  conversationsDir: string,
  conversationId: string,
  overrides: { agentId?: string } = {},
): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id: conversationId,
      title: conversationId,
      projectId: "test-project",
      model: "composer-2.5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      ...overrides,
    }),
  );
}

async function writeHarnessWithStories(conversationId: string): Promise<void> {
  const { conversationsDir } = await loadConfig();
  writeConversationMeta(conversationsDir, conversationId);
  const storiesDir = join(root, "stories");
  mkdirSync(storiesDir, { recursive: true });
  writeFileSync(
    join(storiesDir, "Card.stories.tsx"),
    `export default { title: "direction-a/Card" };
export const Default = {
  render: () => <div style={{ padding: 16, background: "#3366cc", color: "white" }}>Default card</div>,
};
export const Hover = {
  render: () => <div style={{ padding: 16, background: "#2244aa", color: "white" }}>Hover card</div>,
};`,
    "utf8",
  );

  const targetRoot = join(root, "target");
  const cssEntry = join(root, "styles.css");
  const aliasDir = join(root, "alias");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(aliasDir, { recursive: true });
  writeFileSync(cssEntry, "body { margin: 0; }", "utf8");

  const config = {
    targetRoot,
    reactRoot: join(appDir, "node_modules"),
    cssEntries: [cssEntry],
    aliases: { "@target": aliasDir },
    storiesGlobs: [join(storiesDir, "**", "*.stories.tsx")],
  };

  const { harnessConfigPath } = await loadScratch();
  const path = harnessConfigPath(conversationId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config), "utf8");
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-capture-"));
  issuesDir = join(root, "issues");
  outDir = join(root, "captures");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  await startFixtureServer();
});

afterEach(async () => {
  await stopFixtureServer();
  const { stopMockupStack } = await loadStack().catch(() => ({
    stopMockupStack: async () => ({ stopped: false, state: null }),
  }));
  await stopMockupStack("capture-test").catch(() => undefined);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("captureFilename", () => {
  it("slugifies the story id and appends the viewport", async () => {
    const { captureFilename } = await loadCapture();
    expect(captureFilename("direction-a-card--default", "phone")).toBe(
      "direction-a-card-default-phone.png",
    );
  });
});

describe("captureStoryStates", () => {
  it("writes one PNG per state and viewport with absolute paths", async () => {
    const { captureStoryStates } = await loadCapture();

    const results = await captureStoryStates({
      baseUrl,
      outDir,
      states: directionAStates,
      viewports: ["phone"],
    });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.viewport)).toEqual(["phone", "phone"]);
    expect(results.map((result) => result.storyId).sort()).toEqual([
      "direction-a-card--default",
      "direction-a-card--hover",
    ]);

    for (const result of results) {
      expect(result.absolutePath).toBe(resolve(result.absolutePath));
      expect(result.absolutePath.startsWith(resolve(outDir))).toBe(true);
      expect(existsSync(result.absolutePath)).toBe(true);
      const bytes = readFileSync(result.absolutePath);
      expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    }
  });

  it("captures each viewport separately", async () => {
    const { captureStoryStates } = await loadCapture();

    const results = await captureStoryStates({
      baseUrl,
      outDir,
      states: [directionAStates[0]!],
      viewports: ["phone", "desktop"],
    });

    expect(results).toEqual([
      expect.objectContaining({
        storyId: "direction-a-card--default",
        viewport: "phone",
        absolutePath: resolve(outDir, "direction-a-card-default-phone.png"),
      }),
      expect.objectContaining({
        storyId: "direction-a-card--default",
        viewport: "desktop",
        absolutePath: resolve(outDir, "direction-a-card-default-desktop.png"),
      }),
    ]);
  });
});

describe("captureStoryStates against a running harness", () => {
  it(
    "captures every state for a direction at phone",
    async () => {
      await writeHarnessWithStories("capture-test");
      const { startMockupStack, stopMockupStack } = await loadStack();
      const { listStoryStates } = await loadStoryStates();
      const { captureStoryStates } = await loadCapture();

      const handle = await startMockupStack("capture-test");
      try {
        const states = await listStoryStates(handle.state.baseUrl, "direction-a");
        expect(states.length).toBeGreaterThan(1);

        const results = await captureStoryStates({
          baseUrl: handle.state.baseUrl,
          outDir,
          states,
          viewports: ["phone"],
        });

        expect(results).toHaveLength(states.length);
        for (const result of results) {
          expect(result.viewport).toBe("phone");
          expect(existsSync(result.absolutePath)).toBe(true);
          const bytes = readFileSync(result.absolutePath);
          expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
        }
      } finally {
        await stopMockupStack("capture-test");
      }
    },
    120_000,
  );
});
