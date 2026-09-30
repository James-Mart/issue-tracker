import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import {
  parseDelegationEndRecord,
  parseDelegationRecord,
  type DelegationEndRecord,
  type DelegationRecord,
} from "../schemas.js";

export type ParsedDelegationLine =
  | { kind: "start"; record: DelegationRecord }
  | { kind: "end"; record: DelegationEndRecord };

function delegationsPathOf(id: string): string {
  return join(conversationsDir, id, "delegations.jsonl");
}

/** Start and end lines in append order. Malformed lines are skipped. */
export function readDelegationLines(id: string): ParsedDelegationLine[] {
  const path = delegationsPathOf(id);
  if (!existsSync(path)) return [];
  const lines: ParsedDelegationLine[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const endParsed = parseDelegationEndRecord(raw);
    if (endParsed.ok) {
      lines.push({ kind: "end", record: endParsed.record });
      continue;
    }
    const startParsed = parseDelegationRecord(raw);
    if (startParsed.ok) {
      lines.push({ kind: "start", record: startParsed.record });
    }
  }
  return lines;
}
