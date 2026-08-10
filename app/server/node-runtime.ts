/**
 * `@cursor/sdk` needs Node >= 22.13 (`node:sqlite` and matching native bits).
 * The app vendors that runtime via the `node` npm package so host `/opt/node`
 * can stay on an older release; npm scripts put `node_modules/.bin` first on
 * PATH. This gate fails fast if something still starts the server on a too-old
 * binary (segfaults on Agent.create/send are worse than a clear exit).
 */

export const MIN_NODE_VERSION = "22.13.0";

type Triple = readonly [number, number, number];

function parseVersion(version: string): Triple | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function cmp(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/** True when `version` is a semver X.Y.Z at or above {@link MIN_NODE_VERSION}. */
export function isSupportedNodeVersion(version: string): boolean {
  const parsed = parseVersion(version);
  const min = parseVersion(MIN_NODE_VERSION);
  if (!parsed || !min) return false;
  return cmp(parsed, min) >= 0;
}

/**
 * Exit the process when the running Node is below {@link MIN_NODE_VERSION}.
 * Call from the server entry before any SDK / listen work.
 */
export function assertSupportedNodeRuntime(
  version: string = process.versions.node,
): void {
  if (isSupportedNodeVersion(version)) return;
  console.error(
    [
      `issue-tracker requires Node >= ${MIN_NODE_VERSION} (running ${version}).`,
      "The app vendors a compatible runtime via the `node` package — use",
      "`npm run serve` / `npm run dev` / `npm start` from `app/` so",
      "`node_modules/.bin/node` is on PATH. Do not start the server with an",
      "older system Node.",
    ].join("\n"),
  );
  process.exit(1);
}
