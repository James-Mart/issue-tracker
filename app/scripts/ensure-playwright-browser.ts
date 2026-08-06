#!/usr/bin/env -S npx tsx
// Ensure Chromium can actually launch, for `npm run screenshots` and
// `npm run test:e2e`.
//
// On Linux, Playwright needs two independent things: the browser build
// (`playwright install`) and the system shared libraries that build links
// against (`playwright install-deps`, which shells out to apt). Installing
// only the build leaves a binary that dies with a loader error the first time
// anything launches it, so this probes a real launch rather than checking the
// download cache.
//
// Wired to `postinstall` so a fresh clone can capture screenshots without a
// separate provisioning step, and so the check is a fast no-op once the
// browser works. Set ISSUE_TRACKER_SKIP_BROWSER_SETUP=1 to opt out of both the
// probe and the install.

import { spawnSync } from "child_process";
import { createRequire } from "module";

const SKIP_ENV = "ISSUE_TRACKER_SKIP_BROWSER_SETUP";

/** The launch failure, or null when Chromium starts and closes cleanly. */
async function launchError(): Promise<string | null> {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    await browser.close();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function installChromium(): void {
  const require = createRequire(import.meta.url);
  // The `playwright` package does not expose its CLI through `exports`; the
  // runner package re-exports it.
  const cli = require.resolve("@playwright/test/cli");
  // `--with-deps` is the apt step, and exists only on Linux.
  const withDeps = process.platform === "linux" ? ["--with-deps"] : [];
  spawnSync(process.execPath, [cli, "install", ...withDeps, "chromium"], {
    stdio: "inherit",
  });
}

function remedy(): string {
  return process.platform === "linux"
    ? "  npx playwright install --with-deps chromium   (the deps step needs root/sudo for apt)"
    : "  npx playwright install chromium";
}

async function main(): Promise<void> {
  if (process.env[SKIP_ENV]) {
    console.log(`${SKIP_ENV} is set; skipping the Playwright browser check.`);
    return;
  }

  if ((await launchError()) === null) return;

  console.log("Chromium cannot launch; installing the browser and its system libraries...");
  installChromium();

  const remaining = await launchError();
  if (remaining === null) {
    console.log("Chromium is ready; `npm run screenshots` will work.");
    return;
  }

  console.error(
    [
      "",
      "Chromium still cannot launch after `playwright install`:",
      "",
      remaining,
      "",
      "Retry with:",
      remedy(),
      "",
      `Or set ${SKIP_ENV}=1 to install without a working browser (screenshot`,
      "capture and `npm run test:e2e` will not work).",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
