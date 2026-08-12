import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as pwExpect, type Browser } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import { independentBootstrapFaultEntryProblem } from "./bootstrap-fault-entry.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

describe("production bootstrap-fault entry", () => {
  let outDir = "";
  let server: PreviewServer | undefined;
  let browser: Browser | undefined;
  let baseURL = "";

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "bootstrap-fault-dist-"));
    await build({
      configFile: join(appRoot, "vite.config.ts"),
      mode: "production",
      build: { outDir, emptyOutDir: true },
    });
    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(independentBootstrapFaultEntryProblem(html)).toBeUndefined();

    server = await preview({
      configFile: join(appRoot, "vite.config.ts"),
      preview: { host: "127.0.0.1", port: 0, strictPort: false },
      build: { outDir },
    });
    const addr = server.httpServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("preview server has no TCP address");
    }
    baseURL = `http://127.0.0.1:${addr.port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("aborting the main app chunk still paints Fault instead of a blank root", async () => {
    if (!browser) throw new Error("browser not started");
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes("bootstrap-fault")) return route.continue();
      if (path.startsWith("/assets/") && path.endsWith(".js")) {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${baseURL}/`);
    const fault = page.locator("[data-bootstrap-fault]");
    await pwExpect(fault).toBeVisible();
    await pwExpect(fault.getByRole("alert")).toContainText(
      "The app failed to start.",
    );
    await pwExpect(page.locator("#root")).not.toBeEmpty();
    await page.close();
  });
});
