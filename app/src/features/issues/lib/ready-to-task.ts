import type { ThreadView } from "@server/schemas";

/** Open, unlinked review thread. Question threads and resolved threads stay out. */
export function readyToTaskFrom(
  kind: ThreadView["kind"],
  state: ThreadView["state"],
  linkedTaskId: string | undefined,
): boolean {
  return kind === "review" && state === "open" && linkedTaskId === undefined;
}
