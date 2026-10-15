import type { IssueRecord } from "@server/schemas";
import { parentOf } from "./build-tree";
import type { FlowItem } from "./flow";

export type SectionGroupHead =
  | { kind: "title"; epicId: string }
  | { kind: "card"; epicId: string }
  | { kind: "none" };

export type SectionGroup = {
  head: SectionGroupHead;
  items: FlowItem[];
};

type AnchoredGroup = SectionGroup & { anchor: number };

/**
 * One headed group per epic in `rows`, plus one rail for each run of rows
 * with no epic. A group that includes the epic's card sits where that card
 * already sits and the card leads; otherwise the group sits where the epic's
 * first row already sits. Children keep their relative order. Rows with no
 * epic stay in the runs they already form.
 */
export function groupSectionRows(
  rows: readonly FlowItem[],
  byId: Map<string, IssueRecord>,
): SectionGroup[] {
  const epics = new Map<string, AnchoredGroup>();
  const unheaded: AnchoredGroup[] = [];
  let run: AnchoredGroup | null = null;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const epicId = epicIdOfRow(row, byId);
    if (epicId == null) {
      if (run == null) {
        run = { head: { kind: "none" }, items: [], anchor: index };
        unheaded.push(run);
      }
      run.items.push(row);
      continue;
    }

    run = null;
    let group = epics.get(epicId);
    if (group == null) {
      group = {
        head:
          row.issue.kind === "epic"
            ? { kind: "card", epicId }
            : { kind: "title", epicId },
        items: [],
        anchor: index,
      };
      epics.set(epicId, group);
    }

    if (row.issue.kind === "epic") {
      group.head = { kind: "card", epicId };
      group.anchor = index;
      group.items.unshift(row);
    } else {
      group.items.push(row);
    }
  }

  return [...epics.values(), ...unheaded]
    .sort((left, right) => left.anchor - right.anchor)
    .map(({ head, items }) => ({ head, items }));
}

/** Epic card id, or the parent epic of a child story. Rows with no epic return null. */
function epicIdOfRow(
  row: FlowItem,
  byId: Map<string, IssueRecord>,
): string | null {
  if (row.issue.kind === "epic") return row.issue.id;
  if (row.issue.kind !== "story") return null;
  const parentId = parentOf(row.issue);
  if (parentId == null) return null;
  const parent = byId.get(parentId);
  if (parent?.kind !== "epic") return null;
  return parent.id;
}
