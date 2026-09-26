import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHarnessConfig } from "./harness-config.js";
import {
  SMOKE_STORY_GLOB,
  applyMockupStorybookBase,
  buildHarnessStorybookOptions,
  buildReactAliases,
  collectFsAllowPaths,
  harnessCssModuleSource,
  mockupServerChannelShim,
  prefixRootScriptSources,
} from "./storybook-config.js";

let rootDir: string;
let configPath: string;

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config), "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "storybook-config-"));
  configPath = join(rootDir, "harness.json");
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function validConfig(overrides: Record<string, unknown> = {}) {
  const targetRoot = join(rootDir, "target");
  const reactRoot = join(rootDir, "react-node_modules");
  const cssEntry = join(rootDir, "styles", "app.css");
  const aliasDir = join(rootDir, "alias");
  const storiesDir = join(rootDir, "stories");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(reactRoot, { recursive: true });
  mkdirSync(aliasDir, { recursive: true });
  mkdirSync(storiesDir, { recursive: true });
  mkdirSync(join(rootDir, "styles"), { recursive: true });
  writeFileSync(cssEntry, "body {}", "utf8");

  return {
    targetRoot,
    reactRoot,
    cssEntries: [cssEntry],
    aliases: { "@target": aliasDir },
    storiesGlobs: [join(storiesDir, "**", "*.stories.tsx")],
    ...overrides,
  };
}

describe("buildHarnessStorybookOptions", () => {
  it("derives story globs, aliases, and fs.allow paths from a configuration fixture", () => {
    writeConfig(validConfig());
    const harness = loadHarnessConfig(configPath);
    const options = buildHarnessStorybookOptions(harness);

    expect(options.stories).toEqual([
      join(rootDir, "stories", "**", "*.stories.tsx"),
      SMOKE_STORY_GLOB,
    ]);
    expect(options.aliases).toEqual({ "@target": join(rootDir, "alias") });
    expect(options.reactAliases).toEqual(
      buildReactAliases(join(rootDir, "react-node_modules")),
    );
    expect(options.cssEntries).toEqual([join(rootDir, "styles", "app.css")]);

    const fsAllow = collectFsAllowPaths(harness);
    expect(fsAllow).toContain(join(rootDir, "target"));
    expect(fsAllow).toContain(join(rootDir, "stories"));
    expect(fsAllow).toContain(join(rootDir, "styles"));
    expect(options.fsAllow).toEqual(fsAllow);
  });
});

describe("buildReactAliases", () => {
  it("points react, react-dom, and jsx-runtime at reactRoot", () => {
    const reactRoot = "/abs/react-node_modules";
    expect(buildReactAliases(reactRoot)).toEqual({
      react: join(reactRoot, "react"),
      "react-dom": join(reactRoot, "react-dom"),
      "react/jsx-runtime": join(reactRoot, "react/jsx-runtime"),
    });
  });
});

describe("applyMockupStorybookBase", () => {
  it("sets the public prefix as Vite's base and drops the loopback HMR port", () => {
    const config: {
      base?: string;
      plugins?: unknown[];
      server: { hmr: { port?: number; server: { listening: boolean } } };
    } = { server: { hmr: { port: 41005, server: { listening: true } } } };
    applyMockupStorybookBase(config, "/mockups/my-conversation/");
    expect(config.base).toBe("/mockups/my-conversation/");
    expect(config.server.hmr).toEqual({ server: { listening: true } });
    expect(config.plugins).toEqual([
      expect.objectContaining({ name: "mockup-root-scripts" }),
    ]);
  });

  it("leaves the config alone when the process has no public base", () => {
    const config = { server: { hmr: { port: 6006 } } };
    applyMockupStorybookBase(config, undefined);
    expect(config).toEqual({ server: { hmr: { port: 6006 } } });
  });
});

describe("prefixRootScriptSources", () => {
  const base = "/mockups/my-conversation/";

  it("re-roots a root-absolute script src under the base", () => {
    expect(
      prefixRootScriptSources(
        '<head><script type="module" src="/vite-inject-mocker-entry.js"></script>',
        base,
      ),
    ).toBe(
      '<head><script type="module" src="/mockups/my-conversation/vite-inject-mocker-entry.js"></script>',
    );
  });

  it("keeps sources already under the base, relative, or protocol-relative", () => {
    const html = [
      '<script type="module" src="/mockups/my-conversation/@vite/client"></script>',
      '<script src="./sb-preview/runtime.js"></script>',
      '<script src="//cdn.example/x.js"></script>',
      "<script>const src = \"/inline\";</script>",
    ].join("\n");
    expect(prefixRootScriptSources(html, base)).toBe(html);
  });
});

describe("mockupServerChannelShim", () => {
  function runShim(pathname: string, socketUrl: string): string {
    const opened: string[] = [];
    class FakeWebSocket {
      constructor(url: URL | string) {
        opened.push(String(url));
      }
    }
    const window = {
      location: { pathname, href: `http://tracker.test:8060${pathname}` },
      WebSocket: FakeWebSocket as unknown,
    };
    const source = mockupServerChannelShim("/mockups/my-conversation/")
      .replace(/^<script>/, "")
      .replace(/<\/script>$/, "");
    new Function("window", "URL", source)(window, URL);
    new (window.WebSocket as new (url: string) => unknown)(socketUrl);
    return opened[0]!;
  }

  it("moves the server channel under the base on a proxied page", () => {
    expect(
      runShim(
        "/mockups/my-conversation/iframe.html",
        "ws://tracker.test:8060/storybook-server-channel?token=t",
      ),
    ).toBe(
      "ws://tracker.test:8060/mockups/my-conversation/storybook-server-channel?token=t",
    );
  });

  it("leaves other sockets and loopback pages alone", () => {
    expect(
      runShim(
        "/mockups/my-conversation/iframe.html",
        "ws://tracker.test:8060/mockups/my-conversation/?token=hmr",
      ),
    ).toBe("ws://tracker.test:8060/mockups/my-conversation/?token=hmr");
    expect(
      runShim("/iframe.html", "ws://127.0.0.1:41005/storybook-server-channel?token=t"),
    ).toBe("ws://127.0.0.1:41005/storybook-server-channel?token=t");
  });
});

describe("harnessCssModuleSource", () => {
  it("emits one import per cssEntries path, in order", () => {
    expect(
      harnessCssModuleSource(["/abs/a.css", "/abs/b.css"]),
    ).toBe('import "/abs/a.css";\nimport "/abs/b.css";');
  });
});
