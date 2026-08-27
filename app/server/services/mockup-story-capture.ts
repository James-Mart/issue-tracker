import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { slugify } from "./slug.js";
import type { StoryState } from "./mockup-story-states.js";

export type ViewportName = "phone" | "desktop";

export interface CaptureResult {
  storyId: string;
  viewport: ViewportName;
  absolutePath: string;
}

export interface CaptureStoryStatesOptions {
  baseUrl: string;
  outDir: string;
  states: StoryState[];
  viewports: ViewportName[];
}

const VIEWPORT_SIZES: Record<ViewportName, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

const DEVICE_SCALE_FACTOR = 2;
const SETTLE_MS = 800;
const STORY_ROOT_SELECTOR = "#storybook-root";

function storyIframeUrl(baseUrl: string, storyId: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("iframe.html", normalized);
  url.searchParams.set("id", storyId);
  url.searchParams.set("viewMode", "story");
  return url.href;
}

export function captureFilename(stateId: string, viewport: ViewportName): string {
  return `${slugify(stateId)}-${viewport}.png`;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    throw new Error(
      [
        err instanceof Error ? err.message : String(err),
        "",
        "Chromium could not start. Provision it with:",
        "  npx playwright install --with-deps chromium",
        "`npm install` runs that for you via its postinstall step.",
      ].join("\n"),
    );
  }
}

async function waitForStoryRoot(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<void> {
  await page.waitForSelector(STORY_ROOT_SELECTOR, {
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

export async function captureStoryStates(
  options: CaptureStoryStatesOptions,
): Promise<CaptureResult[]> {
  const { baseUrl, outDir, states, viewports } = options;
  mkdirSync(outDir, { recursive: true });
  const absoluteOutDir = resolve(outDir);

  const results: CaptureResult[] = [];
  const browser = await launchBrowser();

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: VIEWPORT_SIZES[viewport],
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });

      try {
        const page = await context.newPage();
        for (const state of states) {
          const url = storyIframeUrl(baseUrl, state.id);
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await waitForStoryRoot(page);

          const absolutePath = resolve(
            absoluteOutDir,
            captureFilename(state.id, viewport),
          );
          await page.locator(STORY_ROOT_SELECTOR).screenshot({
            path: absolutePath,
            type: "png",
          });

          results.push({
            storyId: state.id,
            viewport,
            absolutePath,
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
