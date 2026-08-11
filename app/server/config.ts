import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const PORT = Number(process.env.PORT ?? 8061);

const serverDir = fileURLToPath(new URL(".", import.meta.url));
export const appDir = join(serverDir, "..");
export const pluginDir = join(appDir, "..");
export const issuesDir = process.env.ISSUES_DIR ?? join(pluginDir, "issues");
/** Peer of `issuesDir` — never nested under or written through the issues store. */
export const conversationsDir = join(dirname(issuesDir), "conversations");
/** Peer of `issuesDir` / `conversationsDir` — durable SDK model catalog. */
export const modelSlugCatalogPath = join(
  dirname(issuesDir),
  "model-slug-catalog.json",
);

// Cursor SDK credential. Read once here so every `@cursor/sdk` call can pass it
// explicitly (see `services/agent-sdk.ts`) rather than relying on the SDK's
// ambient `CURSOR_API_KEY` fallback.
export const cursorApiKey = process.env.CURSOR_API_KEY;

// Forum credential store for `file_cursor_sdk_bug`. Deliberately outside the
// plugin: this directory has a git remote, and `~/.cursor/skills_and_plugins.zip`
// archives the whole plugin tree regardless of `.gitignore`.
export const forumCredDir =
  process.env.FORUM_CRED_DIR ?? "/root/.cursor/credentials/issue-tracker-forum";

export const isProdEnv = process.env.NODE_ENV === "production";
export const distDir = join(appDir, "dist");
export const hasBuiltClient = existsSync(distDir);
export const listenPort = PORT;
