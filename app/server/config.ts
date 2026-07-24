import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

export const PORT = Number(process.env.PORT ?? 8061);
export const PROD_PORT = 8061;

const serverDir = fileURLToPath(new URL(".", import.meta.url));
export const appDir = join(serverDir, "..");
export const pluginDir = join(appDir, "..");
export const issuesDir = process.env.ISSUES_DIR ?? join(pluginDir, "issues");

export const isProdEnv = process.env.NODE_ENV === "production";
export const distDir = join(appDir, "dist");
export const hasBuiltClient = existsSync(distDir);
export const listenPort = isProdEnv ? PROD_PORT : PORT;
