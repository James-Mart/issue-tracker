import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { appDir } from "../config.js";

let root: string;
let issuesDir: string;
let stackBaseUrl: string;

async function loadCapture() {
  return import("./mockup-capture.js");
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

function usePerTestIssuesDir(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-capture-entry-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}

describe("parseViewports", () => {
  usePerTestIssuesDir();

  it("accepts phone and phone,desktop", async () => {
    const { parseViewports } = await loadCapture();
    expect(parseViewports("phone")).toEqual(["phone"]);
    expect(parseViewports("phone,desktop")).toEqual(["phone", "desktop"]);
  });

  it("rejects desktop-only and unknown values", async () => {
    const { parseViewports } = await loadCapture();
    expect(() => parseViewports("desktop")).toThrow(/phone,desktop/);
    expect(() => parseViewports("tablet")).toThrow(/phone,desktop/);
  });
});

describe("resolveMockupCaptureBaseUrl", () => {
  usePerTestIssuesDir();

  it("throws naming the conversation when no stack is running", async () => {
    const { resolveMockupCaptureBaseUrl } = await loadCapture();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "missing-conversation");
    expect(() => resolveMockupCaptureBaseUrl("missing-conversation")).toThrow(
      'no mockup stack running for conversation "missing-conversation"',
    );
  });

  it("uses an explicit base URL without reading stack state", async () => {
    const { resolveMockupCaptureBaseUrl } = await loadCapture();
    expect(
      resolveMockupCaptureBaseUrl("missing-conversation", "http://127.0.0.1:9999/"),
    ).toBe("http://127.0.0.1:9999");
  });
});

describe("capture-test stack", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-capture-entry-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    await writeHarnessWithStories("capture-test");
    const { startMockupStack } = await loadStack();
    const handle = await startMockupStack("capture-test");
    stackBaseUrl = handle.state.baseUrl;
  }, 120_000);

  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(async () => {
    try {
      const { stopMockupStack } = await loadStack();
      await stopMockupStack("capture-test");
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reads the live stack base URL when no override is given", async () => {
    const { resolveMockupCaptureBaseUrl } = await loadCapture();
    expect(resolveMockupCaptureBaseUrl("capture-test")).toBe(stackBaseUrl);
  });

  describe("captureMockupStories", () => {
    it(
      "writes captures into the direction scratch and returns absolute paths",
      async () => {
        const { captureMockupStories, mockupCaptureOutDir } = await loadCapture();

        const paths = await captureMockupStories({
          conversationId: "capture-test",
          directionId: "direction-a",
          viewports: ["phone"],
        });

        expect(paths).toHaveLength(2);
        const outDir = mockupCaptureOutDir("capture-test", "direction-a");
        for (const path of paths) {
          expect(path.startsWith(outDir)).toBe(true);
          expect(existsSync(path)).toBe(true);
          expect(readFileSync(path).length).toBeGreaterThan(0);
        }
      },
      120_000,
    );

    it(
      "captures two PNGs per state when both viewports are requested",
      async () => {
        const { captureMockupStories } = await loadCapture();

        const paths = await captureMockupStories({
          conversationId: "capture-test",
          directionId: "direction-a",
          viewports: ["phone", "desktop"],
        });

        expect(paths).toHaveLength(4);
        expect(paths.filter((path) => path.endsWith("-phone.png"))).toHaveLength(2);
        expect(paths.filter((path) => path.endsWith("-desktop.png"))).toHaveLength(2);
      },
      120_000,
    );
  });
});
