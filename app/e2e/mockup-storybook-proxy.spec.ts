/**
 * A real mockup Storybook opened through the tracker's `/mockups/<id>/` proxy,
 * the way an "Open live Storybook" link reaches it. The manager HTML loading
 * is not enough: the preview iframe has to fetch its Vite modules, open the
 * HMR socket and Storybook's server channel, and render the story.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "@playwright/test";
import { expect, test } from "./fixtures";

const CONVERSATION_ID = "mockup-proxy-check";
const STORY_TEXT = "Rendered through the tracker proxy";
// Storybook's server channel always admits IP and localhost origins, so the
// tracker is reached under a plain hostname, as a phone reaches it.
const TRACKER_HOST = "tracker.mockup-proxy.test";

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${TRACKER_HOST} 127.0.0.1`] },
});

type SocketLog = { url: string; framesSent: number; framesReceived: number; errors: string[] };

async function writeHarness(storiesRoot: string): Promise<void> {
  const { appDir, conversationsDir } = await import("../server/config.js");
  const { harnessConfigPath } = await import("../server/services/mockup-scratch.js");

  const metaDir = join(conversationsDir, CONVERSATION_ID);
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, "meta.json"),
    JSON.stringify({
      id: CONVERSATION_ID,
      title: CONVERSATION_ID,
      projectId: "seed-proj",
      model: "composer-2.5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
    }),
  );

  writeFileSync(
    join(storiesRoot, "Card.stories.tsx"),
    `export default { title: "proxy-check/Card" };
export const Default = {
  render: () => <p data-testid="proxy-check">${STORY_TEXT}</p>,
};`,
  );

  const configPath = harnessConfigPath(CONVERSATION_ID);
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      targetRoot: storiesRoot,
      reactRoot: join(appDir, "node_modules"),
      cssEntries: [],
      aliases: {},
      storiesGlobs: [join(storiesRoot, "*.stories.tsx")],
    }),
  );
}

/** The seeded API runs in production mode; the mockup Storybook is a dev server. */
async function startStackInDevelopment(): Promise<void> {
  const { startMockupStack } = await import("../server/services/mockup-stack.js");
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    await startMockupStack(CONVERSATION_ID);
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}

function logSocket(ws: WebSocket, sockets: SocketLog[]): void {
  const entry: SocketLog = { url: ws.url(), framesSent: 0, framesReceived: 0, errors: [] };
  sockets.push(entry);
  ws.on("framesent", () => (entry.framesSent += 1));
  ws.on("framereceived", () => (entry.framesReceived += 1));
  ws.on("socketerror", (error) => entry.errors.push(error));
}

test.describe("live mockup Storybook through the tracker proxy", () => {
  // A cold Storybook boots and transforms the preview on the first request.
  test.describe.configure({ timeout: 240_000 });

  let storiesRoot: string;

  // `seededApp` sets this worker's ISSUES_DIR, which the scratch paths below
  // resolve under, before any server module loads.
  test.beforeAll(async ({ seededApp }) => {
    storiesRoot = mkdtempSync(join(tmpdir(), "it-e2e-mockup-stories-"));
    await writeHarness(storiesRoot);
    await startStackInDevelopment();
  });

  test.afterAll(async () => {
    const { stopMockupStack } = await import("../server/services/mockup-stack.js");
    await stopMockupStack(CONVERSATION_ID);
    rmSync(storiesRoot, { recursive: true, force: true });
  });

  test("renders a story inside the preview iframe with every request under the prefix", async ({
    page,
    seededApp,
  }) => {
    const prefix = `/mockups/${CONVERSATION_ID}/`;
    const trackerUrl = new URL(seededApp.baseURL);
    trackerUrl.hostname = TRACKER_HOST;
    const origin = trackerUrl.origin;
    const escaped: string[] = [];
    const failed: string[] = [];
    const sockets: SocketLog[] = [];

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith(prefix)) {
        escaped.push(request.url());
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    page.on("requestfailed", (request) => {
      failed.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
    });
    page.on("websocket", (ws) => logSocket(ws, sockets));

    await page.goto(`${origin}${prefix}?path=/story/proxy-check-card--default`);

    const preview = page.frameLocator("#storybook-preview-iframe");
    await expect(preview.getByTestId("proxy-check")).toHaveText(STORY_TEXT, {
      timeout: 180_000,
    });

    const channelPath = `${prefix}storybook-server-channel`;
    await expect
      .poll(
        () =>
          sockets.filter(
            (s) => new URL(s.url).pathname === channelPath && s.framesSent > 0,
          ).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(
        () =>
          sockets.filter(
            (s) => new URL(s.url).pathname === prefix && s.framesReceived > 0,
          ).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);

    expect(escaped).toEqual([]);
    expect(failed).toEqual([]);
    expect(sockets.flatMap((s) => s.errors)).toEqual([]);
  });
});
