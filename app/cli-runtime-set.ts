import { readCliFileArg } from "./cli-io.js";
import type { KindSetOptions } from "./cli-kind.js";
import type { IssuePatch, Runtime } from "./server/schemas.js";
import { isRuntimePhaseKey } from "./server/services/runtime.js";

export const RUNTIME_PHASES_HELP =
  "build|start|readiness|seed|redeploy|baseUrl";

/**
 * Resolve a `runtime` patch from CLI flags.
 * Modes: clear all; clear one `--phase`; set one `--phase` with `--file`.
 */
export function resolveRuntimeSet(
  opts: KindSetOptions,
  current: Runtime | undefined,
): IssuePatch {
  const phase = opts.phase;
  const wantsClear = Boolean(opts.clear);

  if (opts.doc !== undefined || opts.attachment !== undefined) {
    throw new Error("--doc and --attachment are not valid for runtime");
  }
  if (opts.workspace !== undefined) {
    throw new Error("--workspace is not valid for runtime");
  }
  if (opts.add !== undefined || opts.remove !== undefined) {
    throw new Error("--add and --remove are not valid for runtime");
  }
  if (opts.rename !== undefined) {
    throw new Error("--rename is not valid for runtime");
  }
  if (opts.key !== undefined) {
    throw new Error("--key is not valid for runtime");
  }

  if (wantsClear) {
    if (opts.file !== undefined) {
      throw new Error("--clear cannot be combined with --file");
    }
    if (phase === undefined) {
      return { runtime: null };
    }
    if (!isRuntimePhaseKey(phase)) {
      throw new Error(
        `unknown runtime phase "${phase}" (expected ${RUNTIME_PHASES_HELP})`,
      );
    }
    const next: Runtime = { ...(current ?? {}) };
    delete next[phase];
    return {
      runtime: Object.keys(next).length === 0 ? null : next,
    };
  }

  if (phase === undefined) {
    throw new Error(`provide --phase <${RUNTIME_PHASES_HELP}> (or --clear)`);
  }
  if (!isRuntimePhaseKey(phase)) {
    throw new Error(
      `unknown runtime phase "${phase}" (expected ${RUNTIME_PHASES_HELP})`,
    );
  }
  if (opts.file === undefined) {
    throw new Error("provide --file <path|-> to set a runtime phase");
  }

  const raw = readCliFileArg(opts.file);
  if (raw === "") {
    throw new Error(
      `runtime phase "${phase}" cannot be empty (clear the phase instead)`,
    );
  }

  const key = phase as keyof Runtime;
  const next: Runtime = { ...(current ?? {}), [key]: raw };
  return { runtime: next };
}
