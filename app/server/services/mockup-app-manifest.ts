import { basename } from "node:path";
import { pluginDir } from "../config.js";
import { runGit } from "./git-read.js";

const MANIFEST_PATHS = ["app/package.json", "app/package-lock.json"] as const;

async function dirtyPluginAppManifestFiles(
  pluginCheckout: string,
): Promise<string[]> {
  const output = await runGit(
    ["diff", "--name-only", "HEAD", "--", ...MANIFEST_PATHS],
    pluginCheckout,
  );
  const text = output.trim();
  if (text.length === 0) return [];
  return text.split("\n").map((path) => basename(path));
}

export async function assertPluginAppManifestClean(
  pluginCheckout: string = pluginDir,
): Promise<void> {
  const dirty = await dirtyPluginAppManifestFiles(pluginCheckout);
  if (dirty.length === 0) return;
  const listed = dirty.join(", ");
  throw new Error(
    `plugin app manifest differs from HEAD: ${listed}. Install packages with \`npm run mockup-deps\` into the conversation sandbox.`,
  );
}
