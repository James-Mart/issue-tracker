// Pure role-family split shared by server and client — no imports, same contract
// as `shape.ts`.

/** Model tokens the harness suffixes role names with. */
export const MODEL_VARIANTS = [
  "composer",
  "grok",
  "opus",
  "sonnet",
  "fable",
] as const satisfies readonly string[];

export function roleFamily(role: string): { family: string; variant?: string } {
  for (const variant of MODEL_VARIANTS) {
    const suffix = `-${variant}`;
    if (role.endsWith(suffix)) {
      return { family: role.slice(0, -suffix.length), variant };
    }
  }
  return { family: role };
}
