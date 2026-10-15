import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mockupScratchDir, sandboxNpmCacheDir } from "./mockup-scratch.js";

/** First listed field wins when one manifest declares the package more than once. */
const DECLARATION_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

const NON_REGISTRY_PREFIXES = ["workspace:", "catalog:", "link:", "file:"] as const;

export interface InstallSandboxPackagesInput {
  conversationId: string;
  from: string;
  packages: readonly string[];
}

export interface SandboxNpmInvocation {
  cwd: string;
  args: readonly string[];
}

export type RunSandboxNpm = (invocation: SandboxNpmInvocation) => void;

function manifestSearchDir(from: string): string {
  const resolved = resolve(from);
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(resolved);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`--from path ${JSON.stringify(from)} does not exist`);
    }
    throw err;
  }
  return info.isDirectory() ? resolved : dirname(resolved);
}

function readManifest(manifestPath: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${manifestPath}: ${detail}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${manifestPath}: not an object`);
  }
  return raw as Record<string, unknown>;
}

function stringRecord(
  manifestPath: string,
  field: string,
  value: unknown,
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${manifestPath}: ${field} is not an object`);
  }
  const deps: Record<string, string> = {};
  for (const [depName, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== "string") {
      throw new Error(`${manifestPath}: ${field}.${depName} is not a string`);
    }
    deps[depName] = range;
  }
  return deps;
}

function rangeInManifest(
  manifestPath: string,
  manifest: Record<string, unknown>,
  name: string,
): string | undefined {
  for (const field of DECLARATION_FIELDS) {
    if (!Object.hasOwn(manifest, field)) continue;
    const section = stringRecord(manifestPath, field, manifest[field]);
    if (Object.hasOwn(section, name)) return section[name];
  }
  return undefined;
}

function assertRegistryRange(name: string, range: string): void {
  if (NON_REGISTRY_PREFIXES.some((prefix) => range.startsWith(prefix))) {
    throw new Error(
      `package ${JSON.stringify(name)} is declared as ${JSON.stringify(range)}; ` +
        `add a harness.json aliases entry for ${JSON.stringify(name)} pointing at that package's source`,
    );
  }
}

function nearestDeclaredRanges(
  from: string,
  names: readonly string[],
): { name: string; range: string }[] {
  const pending = new Set(names);
  const ranges = new Map<string, string>();
  let dir = manifestSearchDir(from);
  for (;;) {
    if (pending.size === 0) break;
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = readManifest(manifestPath);
      for (const name of [...pending]) {
        const range = rangeInManifest(manifestPath, manifest, name);
        if (range === undefined) continue;
        ranges.set(name, range);
        pending.delete(name);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return names.map((name) => {
    const range = ranges.get(name);
    if (range === undefined) {
      throw new Error(
        `package ${JSON.stringify(name)} is not declared in any package.json at or above ${JSON.stringify(from)}`,
      );
    }
    assertRegistryRange(name, range);
    return { name, range };
  });
}

function dependencyMap(
  manifestPath: string,
  manifest: Record<string, unknown>,
): Record<string, string> {
  if (!Object.hasOwn(manifest, "dependencies")) return {};
  return stringRecord(manifestPath, "dependencies", manifest.dependencies);
}

function recordSandboxDependencies(
  scratch: string,
  installed: { name: string; range: string }[],
): void {
  const manifestPath = join(scratch, "package.json");
  const manifest = existsSync(manifestPath)
    ? readManifest(manifestPath)
    : { name: "mockup-sandbox", private: true };
  const dependencies = dependencyMap(manifestPath, manifest);
  for (const pkg of installed) {
    dependencies[pkg.name] = pkg.range;
  }
  manifest.dependencies = dependencies;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function npmFailureDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  return err.message;
}

function defaultRunSandboxNpm(invocation: SandboxNpmInvocation): void {
  try {
    execFileSync("npm", invocation.args, {
      cwd: invocation.cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`npm install failed: ${npmFailureDetail(err)}`);
  }
}

/**
 * Install target-declared packages into the conversation sandbox at the
 * declared ranges. Refuses undeclared packages and non-registry ranges
 * before it writes.
 */
export function installSandboxPackages(
  input: InstallSandboxPackagesInput,
  runNpm: RunSandboxNpm = defaultRunSandboxNpm,
): { installed: { name: string; range: string }[] } {
  if (input.packages.length === 0) {
    throw new Error("at least one package is required");
  }
  const installed = nearestDeclaredRanges(input.from, input.packages);
  const scratch = mockupScratchDir(input.conversationId);
  recordSandboxDependencies(scratch, installed);
  runNpm({
    cwd: scratch,
    args: ["install", "--ignore-scripts", "--cache", sandboxNpmCacheDir(scratch)],
  });
  return { installed };
}
