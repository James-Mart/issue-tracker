import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

export const PORT = Number(process.env.PORT ?? 8061);
export const PROD_PORT = 8061;

const serverDir = fileURLToPath(new URL(".", import.meta.url));
export const appDir = join(serverDir, "..");
export const pluginDir = join(appDir, "..");
export const issuesDir = process.env.ISSUES_DIR ?? join(pluginDir, "issues");

// Cursor SDK credential. Read once here so every `@cursor/sdk` call can pass it
// explicitly (see `services/agent-sdk.ts`) rather than relying on the SDK's
// ambient `CURSOR_API_KEY` fallback.
export const cursorApiKey = process.env.CURSOR_API_KEY;

export const isProdEnv = process.env.NODE_ENV === "production";
export const distDir = join(appDir, "dist");
export const hasBuiltClient = existsSync(distDir);
export const listenPort = isProdEnv ? PROD_PORT : PORT;
