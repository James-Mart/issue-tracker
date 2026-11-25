import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  harnessConfigSchema,
  type HarnessConfig,
} from "../../.storybook/harness-config.js";
import { isInsideDir, storiesGlobRoot } from "../../.storybook/harness-paths.js";
import { isSlugSafe } from "../slug.js";
import { dependencyMap, readManifest } from "./mockup-sandbox.js";

/**
 * A replay bundle is one direction's gzip tar. Its root holds the shared
 * `harness.json` and `package.json`, the Vite config `harness.json` names (at
 * its path under the tree root), and that direction's files. A tree is laid
 * out like the planning scratch: the shared pair at its root and one folder
 * per direction id.
 */

export const STORY_FILE_RE = /\.stories\.(tsx|ts|jsx|js|mdx)$/;

const HARNESS_FILE = "harness.json";
const MANIFEST_FILE = "package.json";

interface ExtractedReplayBundle {
  dir: string;
  harness: HarnessConfig;
  manifest: Record<string, unknown>;
  /** The tree the bundle was packed from, read off its own stories glob. */
  sourceRoot: string;
  viteConfigRel: string | undefined;
  directionFiles: string[];
}

function readHarness(path: string): HarnessConfig {
  const parsed = harnessConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`invalid harness configuration at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function viteConfigRelative(harness: HarnessConfig, root: string): string | undefined {
  if (harness.viteConfigPath === undefined) return undefined;
  if (!isInsideDir(root, harness.viteConfigPath)) {
    throw new Error(`viteConfigPath ${harness.viteConfigPath} is outside the tree ${root}`);
  }
  return relative(root, harness.viteConfigPath);
}

/** Installed packages and dot entries (npm cache, Vite cache) are never bundle content. */
function isBundledName(name: string): boolean {
  return name !== "node_modules" && !name.startsWith(".");
}

function listFiles(dir: string, rel = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!isBundledName(name)) continue;
    const full = join(dir, name);
    const childRel = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) found.push(...listFiles(full, childRel));
    else found.push(childRel);
  }
  return found;
}

function copyInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function runTar(args: string[], what: string): void {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`failed to ${what}: ${result.stderr || result.stdout}`);
  }
}

function requireFile(path: string, owner: string): void {
  if (!existsSync(path)) throw new Error(`${owner} has no ${basename(path)}`);
}

/**
 * An alias or CSS entry inside the tree is archived only as part of this
 * direction's folder. A path elsewhere in the tree is not in the bundle and
 * would be missing after restore.
 */
function assertPackedHarnessPaths(
  harness: HarnessConfig,
  treeRoot: string,
  directionRoot: string,
): void {
  const entries = [
    ...harness.cssEntries.map((entry) => ["cssEntries", entry] as const),
    ...Object.entries(harness.aliases).map(
      ([alias, entry]) => [`aliases.${alias}`, entry] as const,
    ),
  ];
  for (const [field, value] of entries) {
    if (isInsideDir(treeRoot, value) && !isInsideDir(directionRoot, value)) {
      throw new Error(
        `${field} ${value} is inside the replay tree ${treeRoot} outside ${directionRoot}`,
      );
    }
  }
}

/** Direction folders the tree's harness lists that exist directly under the tree root. */
export function directionIdsInReplayTree(treeRoot: string): string[] {
  const harnessPath = join(treeRoot, HARNESS_FILE);
  if (!existsSync(harnessPath)) return [];
  const ids = new Set<string>();
  for (const glob of readHarness(harnessPath).storiesGlobs) {
    const dir = storiesGlobRoot(glob);
    const directionId = basename(dir);
    if (!isSlugSafe(directionId) || dir !== join(treeRoot, directionId)) continue;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    ids.add(directionId);
  }
  return [...ids].sort();
}

/** Bytes of `directionId`'s replay bundle packed from `treeRoot`. */
export function packReplayBundle(treeRoot: string, directionId: string): Buffer {
  const owner = `replay tree ${treeRoot}`;
  requireFile(join(treeRoot, HARNESS_FILE), owner);
  requireFile(join(treeRoot, MANIFEST_FILE), owner);
  const harness = readHarness(join(treeRoot, HARNESS_FILE));
  const viteRel = viteConfigRelative(harness, treeRoot);
  const shared = [HARNESS_FILE, MANIFEST_FILE, ...(viteRel ? [viteRel] : [])];

  const directionRoot = join(treeRoot, directionId);
  if (!existsSync(directionRoot) || !statSync(directionRoot).isDirectory()) {
    throw new Error(`${owner} has no folder for direction ${JSON.stringify(directionId)}`);
  }
  const files = listFiles(directionRoot);
  if (!files.some((file) => STORY_FILE_RE.test(file))) {
    throw new Error(`no story files for direction ${JSON.stringify(directionId)}`);
  }
  const clash = files.find((file) => shared.includes(file));
  if (clash) {
    throw new Error(
      `direction ${JSON.stringify(directionId)} holds ${clash}, which its replay bundle reserves for the shared tree file`,
    );
  }
  assertPackedHarnessPaths(harness, treeRoot, directionRoot);

  const out = mkdtempSync(join(tmpdir(), "replay-bundle-"));
  try {
    const archive = join(out, "bundle.tar.gz");
    runTar(
      [
        "-czf",
        archive,
        "-C",
        treeRoot,
        ...shared.map((rel) => `./${rel}`),
        "-C",
        directionRoot,
        ...files.map((rel) => `./${rel}`),
      ],
      `pack the replay bundle for ${directionId}`,
    );
    return readFileSync(archive);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function sourceRootFor(harness: HarnessConfig, directionId: string): string {
  const glob = harness.storiesGlobs.find(
    (entry) => basename(storiesGlobRoot(entry)) === directionId,
  );
  if (!glob) {
    throw new Error(
      `replay bundle for ${JSON.stringify(directionId)}: harness.json has no storiesGlobs entry under a ${JSON.stringify(directionId)} folder`,
    );
  }
  return dirname(storiesGlobRoot(glob));
}

function extractReplayBundle(bundlePath: string, directionId: string): ExtractedReplayBundle {
  const dir = mkdtempSync(join(tmpdir(), "replay-bundle-"));
  try {
    runTar(["-xzf", bundlePath, "-C", dir], `unpack ${basename(bundlePath)}`);
    const owner = `replay bundle ${basename(bundlePath)}`;
    requireFile(join(dir, HARNESS_FILE), owner);
    requireFile(join(dir, MANIFEST_FILE), owner);
    const harness = readHarness(join(dir, HARNESS_FILE));
    const sourceRoot = sourceRootFor(harness, directionId);
    const viteConfigRel = viteConfigRelative(harness, sourceRoot);
    if (viteConfigRel) requireFile(join(dir, viteConfigRel), owner);
    const shared = [HARNESS_FILE, MANIFEST_FILE, ...(viteConfigRel ? [viteConfigRel] : [])];
    return {
      dir,
      harness,
      manifest: readManifest(join(dir, MANIFEST_FILE)),
      sourceRoot,
      viteConfigRel,
      directionFiles: listFiles(dir).filter((file) => !shared.includes(file)),
    };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function rebaseHarness(harness: HarnessConfig, from: string, to: string): HarnessConfig {
  const move = (path: string) =>
    path === from || path.startsWith(`${from}${sep}`) ? `${to}${path.slice(from.length)}` : path;
  return {
    targetRoot: move(harness.targetRoot),
    cssEntries: harness.cssEntries.map(move),
    aliases: Object.fromEntries(
      Object.entries(harness.aliases).map(([alias, path]) => [alias, move(path)]),
    ),
    storiesGlobs: harness.storiesGlobs.map(move),
    ...(harness.viteConfigPath === undefined
      ? {}
      : { viteConfigPath: move(harness.viteConfigPath) }),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Unpack bundles into `treeRoot`. Each bundle's direction folder is replaced.
 * The shared harness and manifest are rewritten with paths under each
 * bundle's source tree moved under `treeRoot`; the stories globs keep every
 * direction folder present in the tree, and dependencies are the union.
 * Other folders and installed packages stay. Every bundle is read before
 * the tree changes, so a bad bundle leaves the tree as it was.
 */
export function unpackReplayBundles(
  treeRoot: string,
  bundles: readonly { directionId: string; path: string }[],
): void {
  if (bundles.length === 0) throw new Error("no replay bundles to unpack");
  const extracted: ExtractedReplayBundle[] = [];
  try {
    for (const bundle of bundles) {
      extracted.push(extractReplayBundle(bundle.path, bundle.directionId));
    }
    mkdirSync(treeRoot, { recursive: true });
    const treeHarnessPath = join(treeRoot, HARNESS_FILE);
    const globs = new Set(
      existsSync(treeHarnessPath) ? readHarness(treeHarnessPath).storiesGlobs : [],
    );
    let harness: HarnessConfig | undefined;
    let manifest: Record<string, unknown> = {};
    const dependencies: Record<string, string> = {};
    for (const [index, bundle] of bundles.entries()) {
      const unpacked = extracted[index]!;
      const target = join(treeRoot, bundle.directionId);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      for (const rel of unpacked.directionFiles) {
        copyInto(join(unpacked.dir, rel), join(target, rel));
      }
      if (unpacked.viteConfigRel) {
        copyInto(join(unpacked.dir, unpacked.viteConfigRel), join(treeRoot, unpacked.viteConfigRel));
      }
      harness = rebaseHarness(unpacked.harness, unpacked.sourceRoot, treeRoot);
      for (const glob of harness.storiesGlobs) globs.add(glob);
      manifest = unpacked.manifest;
      Object.assign(
        dependencies,
        dependencyMap(join(unpacked.dir, MANIFEST_FILE), unpacked.manifest),
      );
    }
    writeJson(treeHarnessPath, {
      ...harness!,
      storiesGlobs: [...globs].filter((glob) => existsSync(storiesGlobRoot(glob))),
    });
    writeJson(join(treeRoot, MANIFEST_FILE), { ...manifest, dependencies });
  } finally {
    for (const unpacked of extracted) rmSync(unpacked.dir, { recursive: true, force: true });
  }
}
