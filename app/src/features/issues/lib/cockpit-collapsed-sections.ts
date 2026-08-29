import type { FlowBucketKey } from "../components/flow-buckets-sections";

export const COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY =
  "issue-tracker.cockpit-collapsed-sections";

const FLOW_BUCKET_KEYS = new Set<FlowBucketKey>([
  "needsAttention",
  "inFlight",
  "ready",
  "awaitingPlanning",
  "recentlyMerged",
]);

function isFlowBucketKey(value: unknown): value is FlowBucketKey {
  return typeof value === "string" && FLOW_BUCKET_KEYS.has(value as FlowBucketKey);
}

export function readCockpitCollapsedSectionKeys(
  storage: Pick<Storage, "getItem"> = localStorage,
): ReadonlySet<FlowBucketKey> {
  if (typeof storage.getItem !== "function") return new Set();
  const raw = storage.getItem(COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isFlowBucketKey));
  } catch {
    return new Set();
  }
}

export function writeCockpitCollapsedSectionKeys(
  keys: Iterable<FlowBucketKey>,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  if (typeof storage.setItem !== "function") return;
  storage.setItem(
    COCKPIT_COLLAPSED_SECTIONS_STORAGE_KEY,
    JSON.stringify([...keys]),
  );
}

export function toggleCockpitCollapsedSectionKey(
  collapsed: ReadonlySet<FlowBucketKey>,
  key: FlowBucketKey,
): Set<FlowBucketKey> {
  const next = new Set(collapsed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
