import { readCliFileArg } from "./cli-io.js";
import type { KindSetOptions } from "./cli-kind.js";
import { assertSecretKey } from "./server/services/secret-store.js";

export type SecretsSetAction =
  | { action: "set"; key: string; value: string }
  | { action: "delete"; key: string };

/**
 * Resolve a `secrets` write from CLI flags.
 * Modes: set one `--key` with `--file`; remove one with `--key --clear`.
 */
export function resolveSecretsSet(opts: KindSetOptions): SecretsSetAction {
  const key = opts.key;
  const wantsClear = Boolean(opts.clear);

  if (opts.doc !== undefined || opts.attachment !== undefined) {
    throw new Error("--doc and --attachment are not valid for secrets");
  }
  if (opts.workspace !== undefined) {
    throw new Error("--workspace is not valid for secrets");
  }
  if (opts.add !== undefined || opts.remove !== undefined) {
    throw new Error("--add and --remove are not valid for secrets");
  }
  if (opts.rename !== undefined) {
    throw new Error("--rename is not valid for secrets");
  }
  if (opts.phase !== undefined) {
    throw new Error("--phase is not valid for secrets");
  }

  if (key === undefined) {
    throw new Error("provide --key <KEY> with --file or --clear");
  }
  assertSecretKey(key);

  if (wantsClear) {
    if (opts.file !== undefined) {
      throw new Error("--clear cannot be combined with --file");
    }
    return { action: "delete", key };
  }

  if (opts.file === undefined) {
    throw new Error("provide --file <path|-> to set a secret value");
  }

  return { action: "set", key, value: readCliFileArg(opts.file) };
}
