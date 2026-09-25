import path from "node:path";
import type { Plugin } from "vite";
import type { HarnessConfig } from "./harness-config.js";

/** Committed harness smoke story — always included when a target config is loaded. */
export const SMOKE_STORY_GLOB = "./*.stories.@(ts|tsx)";

type StorybookHmr = { port?: number; path?: string };

type MockupViteConfig = {
  base?: string;
  plugins?: unknown[];
  server?: { hmr?: boolean | StorybookHmr };
};

const SERVER_CHANNEL_PATH = "/storybook-server-channel";

/** Re-root `<script src="/…">` tags that are not already under `base`. */
export function prefixRootScriptSources(html: string, base: string): string {
  return html.replace(
    /(<script\b[^>]*?\bsrc=")(\/(?!\/)[^"]*)"/g,
    (match, head: string, src: string) =>
      src.startsWith(base) ? match : `${head}${base}${src.slice(1)}"`,
  );
}

/**
 * Storybook's builder-vite injects the mocker entry as a root-absolute
 * `<script src>` after Vite has applied `base` to the page.
 */
function mockupRootScriptsPlugin(base: string): Plugin {
  return {
    name: "mockup-root-scripts",
    transformIndexHtml: {
      order: "post",
      handler: (html) => prefixRootScriptSources(html, base),
    },
  };
}

/**
 * Serve Storybook's Vite modules under the public `/mockups/<conversationId>/`
 * prefix. The tracker proxy strips that prefix onto Storybook's loopback root,
 * where Storybook's own routes (`/`, `/iframe.html`, `/index.json`) live; Vite
 * in middleware mode serves both prefixed and bare paths, so loopback captures
 * still load. The HMR socket path derives from `base`. Dropping `hmr.port`
 * keeps the browser on the tracker origin instead of the loopback port.
 */
export function applyMockupStorybookBase(
  viteConfig: MockupViteConfig,
  base: string | undefined,
): void {
  if (!base) return;
  viteConfig.base = base;
  (viteConfig.plugins ??= []).push(mockupRootScriptsPlugin(base));
  const hmr = viteConfig.server?.hmr;
  if (hmr && typeof hmr === "object") delete hmr.port;
}

/**
 * Storybook opens its server channel at `/storybook-server-channel` on the
 * page's host, outside any prefix. On a page served under `base`, repoint that
 * socket under `base`; on loopback the page is at `/` and nothing changes.
 */
export function mockupServerChannelShim(base: string): string {
  return `<script>
(() => {
  const base = ${JSON.stringify(base)};
  if (!window.location.pathname.startsWith(base)) return;
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      const target = new URL(url, window.location.href);
      if (target.pathname === ${JSON.stringify(SERVER_CHANNEL_PATH)}) {
        target.pathname = base + ${JSON.stringify(SERVER_CHANNEL_PATH.slice(1))};
      }
      super(target, protocols);
    }
  };
})();
</script>`;
}

/** Directory prefix of a glob pattern (path segment before the first wildcard). */
export function storiesGlobRoot(glob: string): string {
  const wildcardIndex = glob.search(/[*?[{]/);
  if (wildcardIndex === -1) {
    return path.dirname(glob);
  }
  const prefix = glob.slice(0, wildcardIndex).replace(/\/+$/, "");
  return prefix || path.sep;
}

export function collectFsAllowPaths(config: HarnessConfig): string[] {
  const paths = new Set<string>([config.targetRoot]);
  for (const glob of config.storiesGlobs) {
    paths.add(storiesGlobRoot(glob));
  }
  for (const entry of config.cssEntries) {
    paths.add(path.dirname(entry));
  }
  return [...paths];
}

export type HarnessStorybookOptions = {
  stories: string[];
  aliases: Record<string, string>;
  reactAliases: Record<string, string>;
  cssEntries: string[];
  fsAllow: string[];
  viteConfigPath: string | undefined;
};

/** One React resolution root so the preview and target components share an instance. */
export function buildReactAliases(reactRoot: string): Record<string, string> {
  return {
    react: path.join(reactRoot, "react"),
    "react-dom": path.join(reactRoot, "react-dom"),
    "react/jsx-runtime": path.join(reactRoot, "react/jsx-runtime"),
  };
}

/** Source for the virtual module preview.ts imports — one import per cssEntries path, in order. */
export function harnessCssModuleSource(cssEntries: string[]): string {
  return cssEntries.map((entry) => `import ${JSON.stringify(entry)};`).join("\n");
}

export const HARNESS_CSS_VIRTUAL_ID = "virtual:harness-css";

export function buildHarnessStorybookOptions(
  config: HarnessConfig,
): HarnessStorybookOptions {
  return {
    stories: [...config.storiesGlobs, SMOKE_STORY_GLOB],
    aliases: config.aliases,
    reactAliases: buildReactAliases(config.reactRoot),
    cssEntries: config.cssEntries,
    fsAllow: collectFsAllowPaths(config),
    viteConfigPath: config.viteConfigPath,
  };
}
