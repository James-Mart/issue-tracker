import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  flowItemNeedsAttention,
  type FlowBuckets,
  type FlowItem,
} from "../lib/flow";

type FlowBucketKey = keyof FlowBuckets | "needsAttention";

export type FlowBucketDef = {
  key: FlowBucketKey;
  label: string;
  empty?: string;
  hideWhenEmpty?: boolean;
  collapsedByDefault?: boolean;
  compact?: boolean;
};

/** Cockpit bucket order and chrome; overview uses the same labels with legacy layout. */
export const FLOW_BUCKET_DEFS: FlowBucketDef[] = [
  {
    key: "needsAttention",
    label: "Needs attention",
    hideWhenEmpty: true,
  },
  {
    key: "inFlight",
    label: "In flight",
    empty: "Nothing in flight. Pick up Ready work or start a Story.",
    hideWhenEmpty: true,
  },
  {
    key: "ready",
    label: "Ready",
    empty: "Nothing ready. Unblock a dependency, or add work in Structure.",
    hideWhenEmpty: true,
    compact: true,
  },
  {
    key: "blocked",
    label: "Blocked",
    empty: "Nothing blocked. Dependencies are clear.",
    hideWhenEmpty: true,
    collapsedByDefault: true,
  },
  {
    key: "recentlyMerged",
    label: "Recently merged",
    empty: "Nothing merged recently. Finish a Story to land it here.",
    hideWhenEmpty: true,
    collapsedByDefault: true,
  },
];

const OVERVIEW_BUCKET_KEYS = new Set<FlowBucketKey>([
  "needsAttention",
  "inFlight",
  "ready",
  "blocked",
  "recentlyMerged",
]);

/** Pull flagged rows into the virtual needs-attention bucket. */
export function partitionCockpitBuckets(buckets: FlowBuckets): {
  needsAttention: FlowItem[];
  buckets: FlowBuckets;
} {
  const needsAttention: FlowItem[] = [];
  const take = (items: FlowItem[]) => {
    const rest: FlowItem[] = [];
    for (const item of items) {
      if (flowItemNeedsAttention(item)) needsAttention.push(item);
      else rest.push(item);
    }
    return rest;
  };
  return {
    needsAttention,
    buckets: {
      ready: take(buckets.ready),
      inFlight: take(buckets.inFlight),
      blocked: take(buckets.blocked),
      recentlyMerged: take(buckets.recentlyMerged),
    },
  };
}

function bucketItems(
  key: FlowBucketKey,
  buckets: FlowBuckets,
  needsAttention: FlowItem[],
): FlowItem[] {
  if (key === "needsAttention") return needsAttention;
  return buckets[key];
}

function BucketHeading({
  id,
  label,
  count,
  compact,
}: {
  id: string;
  label: string;
  count: number;
  compact?: boolean;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "font-display font-semibold uppercase tracking-[0.16em] text-[hsl(var(--current))]",
        compact ? "text-[10px]" : "text-[11px]",
      )}
    >
      {label}
      <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </h2>
  );
}

function BucketList({
  items,
  renderRow,
  renderItems,
  compact,
}: {
  items: FlowItem[];
  renderRow?: (item: FlowItem) => ReactNode;
  /** When set, renders the whole bucket body (e.g. cockpit project groups). */
  renderItems?: (items: FlowItem[], compact?: boolean) => ReactNode;
  compact?: boolean;
}) {
  if (renderItems) {
    return (
      <div className={compact ? "mt-2" : "mt-3"}>
        {renderItems(items, compact)}
      </div>
    );
  }

  return (
    <ul
      className={cn(
        "flex list-none flex-col p-0",
        compact ? "mt-2 gap-1" : "mt-3 gap-1.5",
      )}
    >
      {items.map((item) => {
        const row = renderRow?.(item);
        if (row == null) return null;
        return <li key={item.issue.id}>{row}</li>;
      })}
    </ul>
  );
}

function FlowBucketSection({
  def,
  items,
  idPrefix,
  renderRow,
  renderItems,
  variant,
}: {
  def: FlowBucketDef;
  items: FlowItem[];
  idPrefix: string;
  renderRow?: (item: FlowItem) => ReactNode;
  renderItems?: (items: FlowItem[], compact?: boolean) => ReactNode;
  variant: "overview" | "cockpit";
}) {
  const headingId = `${idPrefix}-${def.key}`;
  const count = items.length;
  const hideWhenEmpty =
    def.hideWhenEmpty && (variant === "cockpit" || def.empty == null);
  const collapsed =
    variant === "cockpit" && def.collapsedByDefault && count > 0;
  const compact = variant === "cockpit" && def.compact;

  if (hideWhenEmpty && count === 0) return null;

  const body =
    count === 0 && def.empty ? (
      <p className="mt-3 text-sm text-muted-foreground">{def.empty}</p>
    ) : (
      <BucketList
        items={items}
        renderRow={renderRow}
        renderItems={renderItems}
        compact={compact}
      />
    );

  if (collapsed) {
    return (
      <section key={def.key} aria-labelledby={headingId}>
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 marker:content-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <BucketHeading
              id={headingId}
              label={def.label}
              count={count}
              compact={compact}
            />
          </summary>
          {body}
        </details>
      </section>
    );
  }

  return (
    <section key={def.key} aria-labelledby={headingId}>
      <BucketHeading
        id={headingId}
        label={def.label}
        count={count}
        compact={compact}
      />
      {body}
    </section>
  );
}

/**
 * Bucketed Flow lists: section chrome + empty copy. Surfaces supply each row
 * via `renderRow` (cockpit adds project drill-in; project Flow lens does not).
 */
export function FlowBucketsSections({
  buckets,
  idPrefix,
  renderRow,
  renderItems,
  variant = "overview",
}: {
  buckets: FlowBuckets;
  idPrefix: string;
  renderRow?: (item: FlowItem) => ReactNode;
  /** Optional bucket body renderer; cockpit uses this for project grouping. */
  renderItems?: (items: FlowItem[], compact?: boolean) => ReactNode;
  /** Cockpit foregrounds attention/in-flight work and collapses backlog buckets. */
  variant?: "overview" | "cockpit";
}) {
  const { needsAttention, buckets: displayBuckets } =
    partitionCockpitBuckets(buckets);

  const defs =
    variant === "cockpit"
      ? FLOW_BUCKET_DEFS
      : FLOW_BUCKET_DEFS.filter((def) => OVERVIEW_BUCKET_KEYS.has(def.key));

  return (
    <div
      className={cn(
        "flex flex-col",
        variant === "cockpit" ? "gap-5" : "gap-8",
      )}
    >
      {defs.map((def) => (
        <FlowBucketSection
          key={def.key}
          def={def}
          items={bucketItems(def.key, displayBuckets, needsAttention)}
          idPrefix={idPrefix}
          renderRow={renderRow}
          renderItems={renderItems}
          variant={variant}
        />
      ))}
    </div>
  );
}
