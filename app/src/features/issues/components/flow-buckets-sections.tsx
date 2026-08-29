import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { parentOf } from "../lib/build-tree";
import {
  flowItemNeedsAttention,
  type FlowBuckets,
  type FlowItem,
} from "../lib/flow";
import { projectLensPath } from "../lib/links";

type FlowBucketKey = keyof FlowBuckets | "needsAttention";

export const AWAITING_PLANNING_PREVIEW_LIMIT = 5;

export const READY_EMPTY_COPY =
  "Nothing ready. Unblock a dependency, or add work in Structure.";

function blockedProjectIds(blocked: FlowItem[]): string[] {
  const ids = new Set<string>();
  for (const item of blocked) {
    const projectId = parentOf(item.issue);
    if (projectId) ids.add(projectId);
  }
  return [...ids];
}

/** Empty Ready copy: existing line, or a blocked-work hint when that bucket has rows. */
export function readyEmptyCopy(blocked: FlowItem[]): {
  text: string;
  href: string | null;
} {
  const projectIds = blockedProjectIds(blocked);
  if (projectIds.length === 1) {
    return {
      text: "Nothing ready. Blocked work is waiting in Structure.",
      href: projectLensPath(projectIds[0]!, "structure"),
    };
  }
  if (projectIds.length > 1) {
    return {
      text: "Nothing ready. Blocked work is waiting.",
      href: null,
    };
  }
  return { text: READY_EMPTY_COPY, href: null };
}

function ReadyEmptyState({ blocked }: { blocked: FlowItem[] }) {
  const { text, href } = readyEmptyCopy(blocked);
  if (!href) {
    return <p className="mt-3 text-sm text-muted-foreground">{text}</p>;
  }
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Nothing ready. Blocked work is waiting in{" "}
      <Link to={href} className="text-[hsl(var(--current))] hover:underline">
        Structure
      </Link>
      .
    </p>
  );
}

export type FlowBucketDef = {
  key: FlowBucketKey;
  label: string;
  empty?: string;
  hideWhenEmpty?: boolean;
  compact?: boolean;
  previewLimit?: number;
};

/** Cockpit bucket order and chrome. */
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
    empty: READY_EMPTY_COPY,
    hideWhenEmpty: true,
    compact: true,
  },
  {
    key: "awaitingPlanning",
    label: "Awaiting planning",
    hideWhenEmpty: true,
    previewLimit: AWAITING_PLANNING_PREVIEW_LIMIT,
  },
  {
    key: "recentlyMerged",
    label: "Recently merged",
    empty: "Nothing merged recently. Finish a Story to land it here.",
    hideWhenEmpty: true,
    previewLimit: AWAITING_PLANNING_PREVIEW_LIMIT,
  },
];

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
      awaitingPlanning: take(buckets.awaitingPlanning),
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
  previewLimit,
}: {
  items: FlowItem[];
  renderRow?: (item: FlowItem) => ReactNode;
  /** When set, renders the whole bucket body (e.g. cockpit project groups). */
  renderItems?: (
    items: FlowItem[],
    compact?: boolean,
    previewLimit?: number,
  ) => ReactNode;
  compact?: boolean;
  previewLimit?: number;
}) {
  if (renderItems) {
    return (
      <div className={compact ? "mt-2" : "mt-3"}>
        {renderItems(items, compact, previewLimit)}
      </div>
    );
  }

  return (
    <FlowPreviewedItems
      items={items}
      previewLimit={previewLimit}
      listClassName={compact ? "mt-2 gap-1" : "mt-3 gap-1.5"}
      renderItem={(item) => renderRow?.(item)}
    />
  );
}

/** List that shows `previewLimit` rows, then a Show all control for the rest. */
export function FlowPreviewedItems({
  items,
  previewLimit,
  listClassName,
  renderItem,
}: {
  items: FlowItem[];
  previewLimit?: number;
  listClassName?: string;
  renderItem: (item: FlowItem) => ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped =
    previewLimit != null && !showAll && items.length > previewLimit;
  const visible = capped ? items.slice(0, previewLimit) : items;

  return (
    <>
      <ul className={cn("flex list-none flex-col p-0", listClassName)}>
        {visible.map((item) => {
          const row = renderItem(item);
          if (row == null) return null;
          return <li key={item.issue.id}>{row}</li>;
        })}
      </ul>
      {capped ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 min-h-11 font-mono text-xs text-muted-foreground"
          onClick={() => setShowAll(true)}
        >
          Show all
        </Button>
      ) : null}
    </>
  );
}

function FlowBucketSection({
  def,
  items,
  blocked,
  idPrefix,
  renderRow,
  renderItems,
}: {
  def: FlowBucketDef;
  items: FlowItem[];
  blocked: FlowItem[];
  idPrefix: string;
  renderRow?: (item: FlowItem) => ReactNode;
  renderItems?: (
    items: FlowItem[],
    compact?: boolean,
    previewLimit?: number,
  ) => ReactNode;
}) {
  const headingId = `${idPrefix}-${def.key}`;
  const count = items.length;
  const hideWhenEmpty = def.hideWhenEmpty;
  const compact = def.compact;
  const readyBlockedHint = def.key === "ready" && count === 0 && blocked.length > 0;

  if (hideWhenEmpty && count === 0 && !readyBlockedHint) return null;

  const body =
    count === 0 && def.key === "ready" ? (
      <ReadyEmptyState blocked={blocked} />
    ) : count === 0 && def.empty ? (
      <p className="mt-3 text-sm text-muted-foreground">{def.empty}</p>
    ) : (
      <BucketList
        items={items}
        renderRow={renderRow}
        renderItems={renderItems}
        compact={compact}
        previewLimit={def.previewLimit}
      />
    );

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
 * via `renderRow` or a bucket body via `renderItems` (cockpit project groups).
 */
export function FlowBucketsSections({
  buckets,
  idPrefix,
  renderRow,
  renderItems,
}: {
  buckets: FlowBuckets;
  idPrefix: string;
  renderRow?: (item: FlowItem) => ReactNode;
  /** Optional bucket body renderer; cockpit uses this for project grouping. */
  renderItems?: (
    items: FlowItem[],
    compact?: boolean,
    previewLimit?: number,
  ) => ReactNode;
}) {
  const { needsAttention, buckets: displayBuckets } =
    partitionCockpitBuckets(buckets);

  return (
    <div className="flex flex-col gap-5">
      {FLOW_BUCKET_DEFS.map((def) => (
        <FlowBucketSection
          key={def.key}
          def={def}
          items={bucketItems(def.key, displayBuckets, needsAttention)}
          blocked={buckets.blocked}
          idPrefix={idPrefix}
          renderRow={renderRow}
          renderItems={renderItems}
        />
      ))}
    </div>
  );
}
