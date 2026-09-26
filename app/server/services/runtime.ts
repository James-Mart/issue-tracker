import { RUNTIME_PHASE_KEYS } from "../issue-constants.js";
import type { Issue, IssuePatch, Runtime } from "../schemas.js";
import { IssueError } from "./errors.js";

export function isRuntimePhaseKey(value: string): value is keyof Runtime {
  return (RUNTIME_PHASE_KEYS as readonly string[]).includes(value);
}

export function validateRuntime(runtime: Runtime): void {
  for (const key of RUNTIME_PHASE_KEYS) {
    const value = runtime[key];
    if (value !== undefined && value.length === 0) {
      throw new IssueError(
        "validation",
        `runtime phase "${key}" cannot be empty (clear the phase instead)`,
      );
    }
  }
}

export function validateRuntimePatch(existing: Issue, patch: IssuePatch): void {
  if (!("runtime" in patch)) return;
  if (existing.kind !== "project") {
    throw new IssueError("validation", "runtime is only valid on a project");
  }
  const { runtime } = patch;
  if (runtime === null || runtime === undefined) return;
  validateRuntime(runtime);
}

/** Summary/view line listing set phase names only. */
export function formatRuntimeLine(runtime: Runtime): string {
  const parts: string[] = [];
  for (const key of RUNTIME_PHASE_KEYS) {
    if (runtime[key]) parts.push(key);
  }
  return parts.join(", ");
}
