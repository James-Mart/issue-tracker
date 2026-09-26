import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Page } from "@playwright/test";
import {
  BROWSER_ORIGIN_STATE_ENV,
  decideBrowserNavigation,
  installBrowserOriginGuard,
  liveBrowserOriginBaseUrl,
  NO_LIVE_STACK_NAVIGATION_ERROR,
} from "./browser-origin-allowlist.js";

const BASE = "http://psibase.localhost:41234/";

const require = createRequire(import.meta.url);

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

describe("decideBrowserNavigation", () => {
  it("allows the stack origin and its subdomains on the same port", () => {
    expect(
      decideBrowserNavigation("http://psibase.localhost:41234/", BASE),
    ).toEqual({ allowed: true });
    expect(
      decideBrowserNavigation("http://psibase.localhost:41234/projects", BASE),
    ).toEqual({ allowed: true });
    expect(
      decideBrowserNavigation("http://tokens.psibase.localhost:41234/", BASE),
    ).toEqual({ allowed: true });
    expect(
      decideBrowserNavigation(
        "http://tokens.psibase.localhost:41234/tokens",
        BASE,
      ),
    ).toEqual({ allowed: true });
    expect(
      decideBrowserNavigation(
        "http://a.tokens.psibase.localhost:41234/",
        BASE,
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses example.com and another port", () => {
    expect(decideBrowserNavigation("example.com", BASE).allowed).toBe(false);
    expect(decideBrowserNavigation("http://example.com/", BASE).allowed).toBe(
      false,
    );
    expect(
      decideBrowserNavigation("https://example.com/path", BASE).allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation("http://psibase.localhost:41235/", BASE).allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation(
        "http://tokens.psibase.localhost:80/",
        BASE,
      ).allowed,
    ).toBe(false);
  });

  it("refuses hosts that are not subdomains of the stack host", () => {
    expect(
      decideBrowserNavigation("http://notpsibase.localhost:41234/", BASE)
        .allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation("http://psibase.localhost.evil:41234/", BASE)
        .allowed,
    ).toBe(false);
    expect(
      decideBrowserNavigation("https://psibase.localhost:41234/", BASE).allowed,
    ).toBe(false);
  });

  it("refuses every navigation when there is no live stack", () => {
    for (const target of [
      "http://psibase.localhost:41234/",
      "http://tokens.psibase.localhost:41234/",
      "example.com",
      "http://example.com/",
    ]) {
      expect(decideBrowserNavigation(target, null)).toEqual({
        allowed: false,
        message: NO_LIVE_STACK_NAVIGATION_ERROR,
      });
    }
    expect(NO_LIVE_STACK_NAVIGATION_ERROR).toMatch(/agent_stack_start/);
  });
});

describe("liveBrowserOriginBaseUrl", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function writeState(pid: number, startTime: string, baseUrl: string): string {
    const dir = mkdtempSync(join(tmpdir(), "browser-origin-"));
    dirs.push(dir);
    const path = join(dir, "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        conversationId: "conv-1",
        issueId: "story-a",
        worktree: dir,
        port: 41234,
        auxPort: 41233,
        dataDir: join(dir, "data"),
        baseUrl,
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [{ role: "start", pid, startTime }],
      }),
    );
    return path;
  }

  it("returns the live stack base URL and nothing once that process is gone", () => {
    const path = writeState(process.pid, procStartTime(process.pid), BASE);
    expect(liveBrowserOriginBaseUrl(path)).toBe(BASE);
    expect(liveBrowserOriginBaseUrl(join(tmpdir(), "missing-browser-origin.json"))).toBeNull();
    expect(liveBrowserOriginBaseUrl(undefined)).toBeNull();

    const dead = writeState(1 << 30, "1", BASE);
    expect(liveBrowserOriginBaseUrl(dead)).toBeNull();
  });
});

function mockPage(): Page & {
  routes: Array<(route: {
    request: () => { url: () => string };
    continue: () => Promise<void>;
  }) => Promise<void>>;
  continued: string[];
} {
  const routes: Array<(route: {
    request: () => { url: () => string };
    continue: () => Promise<void>;
  }) => Promise<void>> = [];
  const continued: string[] = [];
  const context = {
    route: async (
      _pattern: string,
      handler: (route: {
        request: () => { url: () => string };
        continue: () => Promise<void>;
      }) => Promise<void>,
    ) => {
      routes.push(handler);
    },
  };
  const page = {
    goto: async () => "original-goto",
    goBack: async () => "original-back",
    goForward: async () => "original-forward",
    reload: async () => "original-reload",
    context: () => context,
  };
  return Object.assign(page, { routes, continued }) as unknown as Page & {
    routes: typeof routes;
    continued: string[];
  };
}

describe("installBrowserOriginGuard", () => {
  it("follows the live stack across start and stop", async () => {
    let baseUrl: string | null = null;
    const page = mockPage();
    await installBrowserOriginGuard(page, () => baseUrl);

    await expect(page.goto("http://psibase.localhost:41234/")).rejects.toThrow(
      NO_LIVE_STACK_NAVIGATION_ERROR,
    );
    await expect(page.goBack()).rejects.toThrow(NO_LIVE_STACK_NAVIGATION_ERROR);

    baseUrl = BASE;
    await expect(page.goto("http://tokens.psibase.localhost:41234/")).resolves.toBe(
      "original-goto",
    );
    await expect(page.goto("example.com")).rejects.toThrow(/example\.com/);
    await expect(
      page.goto("http://psibase.localhost:41235/"),
    ).rejects.toThrow(/41235/);

    baseUrl = null;
    await expect(
      page.goto("http://tokens.psibase.localhost:41234/"),
    ).rejects.toThrow(NO_LIVE_STACK_NAVIGATION_ERROR);
  });

  it("blocks a request the navigation method did not name", async () => {
    const page = mockPage();
    await installBrowserOriginGuard(page, () => null);
    const handler = page.routes[0]!;
    await expect(
      handler({
        request: () => ({ url: () => "http://example.com/" }),
        continue: async () => {
          page.continued.push("example");
        },
      }),
    ).rejects.toThrow(NO_LIVE_STACK_NAVIGATION_ERROR);
    expect(page.continued).toEqual([]);

    let baseUrl: string | null = BASE;
    const allowed = mockPage();
    await installBrowserOriginGuard(allowed, () => baseUrl);
    await allowed.routes[0]!({
      request: () => ({ url: () => "http://tokens.psibase.localhost:41234/a" }),
      continue: async () => {
        allowed.continued.push("ok");
      },
    });
    expect(allowed.continued).toEqual(["ok"]);
    baseUrl = null;
    await expect(
      allowed.routes[0]!({
        request: () => ({ url: () => "http://tokens.psibase.localhost:41234/a" }),
        continue: async () => {
          allowed.continued.push("after-stop");
        },
      }),
    ).rejects.toThrow(NO_LIVE_STACK_NAVIGATION_ERROR);
  });
});

describe("playwright page", () => {
  it("refuses goto on a real page until a stack base URL is live", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let baseUrl: string | null = null;
      await installBrowserOriginGuard(page, () => baseUrl);

      await expect(page.goto("http://example.com/")).rejects.toThrow(
        /agent_stack_start/,
      );

      baseUrl = BASE;
      await expect(page.goto("http://example.com/")).rejects.toThrow(
        /outside the live stack/,
      );
      await expect(page.goto("http://psibase.localhost:9999/")).rejects.toThrow(
        /outside the live stack/,
      );

      let allowlistRefusal = false;
      try {
        await page.goto("http://psibase.localhost:41234/");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        allowlistRefusal = /outside the live stack|agent_stack_start/.test(
          message,
        );
      }
      expect(allowlistRefusal).toBe(false);
    } finally {
      await browser.close();
    }
  });
});

describe("browser origin init page", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env[BROWSER_ORIGIN_STATE_ENV];
  });

  it("loads through the Playwright init-page hook and reads the state env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "browser-origin-init-"));
    dirs.push(dir);
    const statePath = join(dir, "state.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        conversationId: "conv-1",
        issueId: "story-a",
        worktree: dir,
        port: 41234,
        auxPort: 41233,
        dataDir: join(dir, "data"),
        baseUrl: BASE,
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [
          {
            role: "start",
            pid: process.pid,
            startTime: procStartTime(process.pid),
          },
        ],
      }),
    );
    process.env[BROWSER_ORIGIN_STATE_ENV] = statePath;

    const init = require("./browser-origin-init-page.cjs") as {
      default: (arg: { page: Page }) => Promise<void>;
    };
    const page = mockPage();
    await init.default({ page });
    await expect(
      page.goto("http://tokens.psibase.localhost:41234/"),
    ).resolves.toBe("original-goto");
    await expect(page.goto("http://example.com/")).rejects.toThrow(
      /outside the live stack/,
    );
  });
});
