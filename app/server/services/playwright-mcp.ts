import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@cursor/sdk";
import {
  browserArtifactsDir,
  browserOriginMcpEnv,
} from "./browser-origin-allowlist.js";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_MCP_CLI = join(
  dirname(require.resolve("@playwright/mcp/package.json")),
  "cli.js",
);
const BROWSER_ORIGIN_INIT_PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  "browser-origin-init-page.cjs",
);

/**
 * Session-scoped Playwright MCP for app-channel agents (headless, isolated
 * context). `--init-page` refuses navigations outside the conversation's live
 * stack. With no conversation, the init page has no state file and refuses
 * every one.
 */
export function playwrightMcpServer(
  conversationId: string | undefined,
): McpServerConfig {
  return {
    command: "node",
    args: [
      PLAYWRIGHT_MCP_CLI,
      "--headless",
      "--isolated",
      "--browser",
      "chromium",
      "--init-page",
      BROWSER_ORIGIN_INIT_PAGE,
    ],
    ...(conversationId !== undefined
      ? {
          env: browserOriginMcpEnv(conversationId),
          cwd: browserArtifactsDir(conversationId),
        }
      : {}),
  };
}
