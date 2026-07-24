import type { ReactNode } from "react";
import type { FlowBuckets, FlowItem } from "../lib/flow";

export const FLOW_BUCKET_DEFS: {
  key: keyof FlowBuckets;
  label: string;
  empty: string;
}[] = [
  {
    key: "inFlight",
    label: "In flight",
    empty: "Nothing in flight. Pick up Ready work or start a Story.",
  },
  {
    key: "ready",
    label: "Ready",
    empty: "Nothing ready. Clear filters, or add work in Structure.",
  },
  {
    key: "blocked",
    label: "Blocked",
    empty: "Nothing blocked. Dependencies are clear.",
  },
  {
    key: "recentlyMerged",
    label: "Recently merged",
    empty: "Nothing merged recently. Merged Stories land here.",
  },
];

/**
 * Bucketed Flow lists: section chrome + empty copy. Surfaces supply each row
 * via `renderRow` (cockpit adds project drill-in; project Flow lens does not).
 */
export function FlowBucketsSections({
  buckets,
  idPrefix,
  renderRow,
}: {
  buckets: FlowBuckets;
  idPrefix: string;
  renderRow: (item: FlowItem) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      {FLOW_BUCKET_DEFS.map(({ key, label, empty }) => {
        const items = buckets[key];
        const headingId = `${idPrefix}-${key}`;
        return (
          <section key={key} aria-labelledby={headingId}>
            <h2
              id={headingId}
              className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--current))]"
            >
              {label}
              <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </h2>
            {items.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
            ) : (
              <ul className="mt-3 flex list-none flex-col gap-1.5 p-0">
                {items.map((item) => {
                  const row = renderRow(item);
                  if (row == null) return null;
                  return <li key={item.issue.id}>{row}</li>;
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
