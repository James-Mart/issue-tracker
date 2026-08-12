/**
 * Transport on the Vite dev path — the `:8060` shape a browser hits during
 * development, where the client arrives as hundreds of separate ES modules and
 * the SharedWorker script is resolved through `?sharedworker&url`. Every other
 * transport spec runs against the built bundle, so nothing else covers it.
 *
 * Both branches of `subscribeTopic` are covered: the SharedWorker branch, and
 * the direct per-tab socket branch a browser without `SharedWorker` falls back
 * to.
 */
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const VITE_BIN = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const READY_TIMEOUT_MS = 90_000;

type DevServer = { baseURL: string; stop: () => Promise<void> };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

/** The client half of `npm run dev`, with `/api` proxied to the seeded API. */
async function startViteDev(apiTarget: string): Promise<DevServer> {
  const port = await freePort();
  const child = spawn(process.execPath, [VITE_BIN], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      // The seeded fixture boots the API in production mode; the server that
      // serves the client here has to stay a dev server.
      NODE_ENV: "development",
      VITE_DEV_PORT: String(port),
      VITE_API_PROXY_TARGET: apiTarget,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => log.push(String(chunk)));
  child.stderr.on("data", (chunk: Buffer) => log.push(String(chunk)));

  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`vite dev server exited: ${log.join("")}`);
    }
    const reachable = await fetch(`${baseURL}/`).then(
      (res) => res.ok,
      // Still binding the port.
      () => false,
    );
    if (reachable) break;
    if (Date.now() > deadline) {
      throw new Error(`vite dev server never came up: ${log.join("")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    baseURL,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });
    },
  };
}

async function setSeedEpicTitle(
  page: Page,
  baseURL: string,
  title: string,
): Promise<void> {
  const res = await page.request.patch(`${baseURL}/api/issues/seed-epic-a`, {
    data: { title },
  });
  if (!res.ok()) {
    throw new Error(`patching seed-epic-a failed: ${res.status()}`);
  }
}

/** Shell paints from the dev module graph, and a server event reaches the tab. */
async function expectShellAndLiveIssueUpdate(
  page: Page,
  baseURL: string,
): Promise<void> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/seed-epic-a`);
  const main = page.getByRole("main");
  await expect(main.getByText("Epic A").first()).toBeVisible();
  await expect(page.locator("[data-bootstrap-fault]")).toHaveCount(0);

  const renamed = `Epic A live ${Date.now()}`;
  try {
    await setSeedEpicTitle(page, baseURL, renamed);
    // Nothing reloads this tab, so the new title can only arrive over the
    // transport as an `issues` frame.
    await expect(main.getByText(renamed).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    // Later tests in this worker share the seeded tree.
    await setSeedEpicTitle(page, baseURL, "Epic A");
  }
}

test.describe("transport on the Vite dev path", () => {
  // A cold dev server transforms the whole client on the first request.
  test.describe.configure({ timeout: 180_000 });

  let dev: DevServer;

  test.beforeAll(async ({ seededApp }) => {
    dev = await startViteDev(seededApp.baseURL);
  });

  test.afterAll(async () => {
    await dev.stop();
  });

  test("SharedWorker branch resolves the dev worker script and stays live", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const workerScriptRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("transport.shared-worker")) {
        workerScriptRequests.push(request.url());
      }
    });
    try {
      await expectShellAndLiveIssueUpdate(page, dev.baseURL);
      expect(await page.evaluate(() => typeof SharedWorker)).toBe("function");
      expect(
        workerScriptRequests.some((url) => url.includes("sharedworker")),
      ).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("recovers from an optimized dep chunk the cached graph can no longer fetch", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let staleChunkResponses = 0;
    await page.route("**/node_modules/.vite/deps/chunk-*", async (route) => {
      // What a browser holding immutable dep files from an older deps directory
      // gets: the chunk those files import is gone. One load only, so the repair
      // has something to recover to.
      if (staleChunkResponses === 0) {
        staleChunkResponses += 1;
        await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
        return;
      }
      await route.continue();
    });

    try {
      await page.goto(`${dev.baseURL}/`);
      await expect(page.getByRole("main")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("[data-bootstrap-fault]")).toHaveCount(0);
      expect(staleChunkResponses).toBe(1);
    } finally {
      await context.close();
    }
  });

  test("Pixel 5 viewport paints the shell, stays live, and revalidates optimized deps", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ...devices["Pixel 5"],
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const depCacheControls: string[] = [];
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/node_modules/.vite/deps/")) {
        depCacheControls.push(response.headers()["cache-control"] ?? "");
      }
    });
    try {
      await expectShellAndLiveIssueUpdate(page, dev.baseURL);
      expect(await page.evaluate(() => typeof SharedWorker)).toBe("function");
      expect(depCacheControls.length).toBeGreaterThan(0);
      expect(
        depCacheControls.every((value) => value === "no-cache"),
      ).toBeTruthy();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("direct branch stays live when SharedWorker is unavailable", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      // Same gate as transport.ts (`typeof SharedWorker !== "undefined"`).
      Object.defineProperty(window, "SharedWorker", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
    const page = await context.newPage();
    try {
      await expectShellAndLiveIssueUpdate(page, dev.baseURL);
      expect(await page.evaluate(() => typeof SharedWorker)).toBe("undefined");
    } finally {
      await context.close();
    }
  });
});
