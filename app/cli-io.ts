import { readFileSync } from "fs";
import type { Command } from "commander";

let stdinForDash: string | undefined;

export function bindCliStdin(contents: string | undefined): () => void {
  if (contents === undefined) return () => {};
  const previous = stdinForDash;
  stdinForDash = contents;
  return () => {
    stdinForDash = previous;
  };
}

/** Read a CLI `--file` path; `-` means stdin. */
export function readCliFileArg(path: string): string {
  if (path === "-") {
    if (stdinForDash !== undefined) return stdinForDash;
    return readFileSync(0, "utf8");
  }
  return readFileSync(path, "utf8");
}

export type CreateDescriptionOpts = {
  description?: string;
  file?: string;
};

// Resolve a description from either inline text or a file path. `--file`
// wins when both are given; returns undefined when neither is provided so callers
// can fall back to the default `# <title>` seed.
export function resolveDescription(
  opts: CreateDescriptionOpts,
): string | undefined {
  if (opts.file) {
    return readCliFileArg(opts.file);
  }
  return opts.description;
}

/** Shared `--description` / `--file` flags for create/add verbs. */
export function withCreateDescriptionOptions(cmd: Command): Command {
  return cmd
    .option("--description <text>", "description.md contents")
    .option(
      "--file <path>",
      "read description.md contents from a file (use - for stdin)",
    );
}
