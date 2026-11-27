import { readFileSync } from "node:fs";

/** `/proc/<pid>/stat` start time. Boot records pin a pid with this token. */
export function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}
