import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `overrideShellExecutor` replaces the SDK's `LocalShellExecutor`. The SDK
 * does not pass that executor in, so a command allowed to run would lose its
 * sandbox policy, permission checks, streaming, and exit reporting.
 *
 * Each build assigns the slot with one of these shapes:
 *
 * `p=e.overrideShellExecutor??(!0===e.suppressDefaultShellExecutor?void 0:new WD(...))`
 * `f=e.overrideShellExecutor??(e.suppressDefaultShellExecutor===!0?void 0:new Tft(...))`
 *
 * The rewrite constructs that same executor and passes it as the last
 * argument of our `execute`. `sdk-shell-host-binding-boot` and
 * `scripts/ensure-sdk-shell-host.ts` run it before `@cursor/sdk` is
 * evaluated, because a module already loaded from the unpatched file keeps
 * the old function.
 */
const SLOT =
  /([A-Za-z_$][\w$]*)=e\.overrideShellExecutor\?\?\((!0===e\.suppressDefaultShellExecutor|e\.suppressDefaultShellExecutor===!0)\?void 0:new ([A-Za-z_$][\w$]*)\(this\.permissionsService,([A-Za-z_$][\w$]*),this\.ignoreService,this\.pendingDecisionStore\)\)/;

const MARKER = "function hostShellBound(user,hostShell)";

const UNRECOGNIZED =
  "@cursor/sdk shell executor slot no longer matches the host-shell binding";

export function rewriteSdkShellBinding(source: string): string | undefined {
  if (source.includes(MARKER)) return undefined;
  if (!source.includes("e.overrideShellExecutor??")) return undefined;
  const next = source.replace(SLOT, (_full, dest, suppress, ctor, core) => {
    const constructed = `new ${ctor}(this.permissionsService,${core},this.ignoreService,this.pendingDecisionStore)`;
    return `${dest}=e.overrideShellExecutor?(${MARKER}{return{execute:function(...n){return user.execute(...n,hostShell)}}})(e.overrideShellExecutor,${constructed}):(${suppress}?void 0:${constructed})`;
  });
  if (next === source) {
    throw new Error(UNRECOGNIZED);
  }
  return next;
}

function javascriptFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) found.push(path);
  }
  return found;
}

function sdkPackageRoot(entry: string): string {
  let dir = dirname(entry);
  for (;;) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (parsed.name === "@cursor/sdk") return dir;
    } catch {
      // Not this directory.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(UNRECOGNIZED);
}

/** Patch every installed `@cursor/sdk` build. Idempotent. */
export function ensureSdkShellHostBinding(): { patched: number; already: number } {
  const require = createRequire(import.meta.url);
  const dist = join(sdkPackageRoot(require.resolve("@cursor/sdk")), "dist");
  let patched = 0;
  let already = 0;
  for (const path of javascriptFiles(dist)) {
    const source = readFileSync(path, "utf8");
    if (source.includes(MARKER)) {
      already += 1;
      continue;
    }
    const next = rewriteSdkShellBinding(source);
    if (next === undefined) continue;
    writeFileSync(path, next);
    patched += 1;
  }
  if (patched + already === 0) {
    throw new Error(UNRECOGNIZED);
  }
  return { patched, already };
}
