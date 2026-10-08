import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { IssueRecord } from "@server/schemas";
import type {
  PrFacts,
  PrUnavailable,
  ProjectPrsResponse,
} from "@server/services/delivery";

/** One Story row's slice of a project PR query — not the whole `prs` map. */
export type RowPrData = {
  entry: PrFacts | PrUnavailable | undefined;
  queryFailed: boolean;
  hasData: boolean;
};

/** Slice for a row that does not show a PR chip, and for a Story before /prs. */
export const IDLE_ROW_PR: RowPrData = {
  entry: undefined,
  queryFailed: false,
  hasData: false,
};

const MISSING_LOADED: RowPrData = {
  entry: undefined,
  queryFailed: false,
  hasData: true,
};

const MISSING_FAILED: RowPrData = {
  entry: undefined,
  queryFailed: true,
  hasData: false,
};

const MISSING_FAILED_WITH_DATA: RowPrData = {
  entry: undefined,
  queryFailed: true,
  hasData: true,
};

function rowPrSame(a: RowPrData, b: RowPrData): boolean {
  return (
    a === b ||
    (a.entry === b.entry &&
      a.hasData === b.hasData &&
      a.queryFailed === b.queryFailed)
  );
}

/**
 * Per-Story PR slices for the structure tree. `stage` keeps the previous
 * slice object when that Story's entry reference and query flags are
 * unchanged (React Query structural sharing preserves unchanged entries).
 * `flush` notifies only Stories whose slice object changed.
 */
export class RowPrStore {
  private data: ProjectPrsResponse | undefined;
  private error: Error | null = null;
  private generation = 0;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly snapshots = new Map<string, RowPrData>();
  private dirty = new Set<string>();

  subscribe = (issueId: string, onChange: () => void): (() => void) => {
    let bucket = this.listeners.get(issueId);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(issueId, bucket);
    }
    bucket.add(onChange);
    return () => {
      bucket.delete(onChange);
      if (bucket.size === 0) this.listeners.delete(issueId);
    };
  };

  /** Read-only. `stage` interns entry slices; missing rows are stable constants. */
  get = (issueId: string): RowPrData =>
    this.snapshots.get(issueId) ?? this.compute(issueId);

  /**
   * Publish the latest project PR query. Returns a generation that changes
   * only when at least one subscribed row's slice changed.
   */
  stage(data: ProjectPrsResponse | undefined, error: Error | null): number {
    if (this.data === data && this.error === error) return this.generation;
    this.data = data;
    this.error = error;
    const ids = new Set<string>([
      ...this.listeners.keys(),
      ...Object.keys(data?.prs ?? {}),
    ]);
    const nextDirty = new Set<string>();
    for (const id of ids) {
      const next = this.compute(id);
      const prev = this.snapshots.get(id);
      if (prev && rowPrSame(prev, next)) continue;
      this.snapshots.set(id, next);
      if (this.listeners.has(id)) nextDirty.add(id);
    }
    this.dirty = nextDirty;
    if (this.dirty.size > 0) this.generation += 1;
    return this.generation;
  }

  flush(): void {
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const bucket = this.listeners.get(id);
      if (!bucket) continue;
      for (const listener of bucket) listener();
    }
  }

  private compute(issueId: string): RowPrData {
    const hasData = this.data != null;
    const queryFailed = this.error != null;
    const entry = this.data?.prs[issueId];
    if (entry === undefined && !hasData && !queryFailed) return IDLE_ROW_PR;
    if (entry === undefined && hasData && !queryFailed) return MISSING_LOADED;
    if (entry === undefined && !hasData && queryFailed) return MISSING_FAILED;
    if (entry === undefined) return MISSING_FAILED_WITH_DATA;
    return { entry, hasData, queryFailed };
  }
}

const RowPrStoreContext = createContext<RowPrStore | null>(null);

export function RowPrStoreProvider({
  data,
  error,
  children,
}: {
  data: ProjectPrsResponse | undefined;
  error: Error | null;
  children: ReactNode;
}) {
  const storeRef = useRef<RowPrStore | null>(null);
  if (storeRef.current === null) storeRef.current = new RowPrStore();
  const store = storeRef.current;
  // Stage before rows read. Generation changes only when a subscribed
  // Story's slice changes; flush notifies those rows and no others.
  const generation = store.stage(data, error);
  useLayoutEffect(() => {
    store.flush();
  }, [generation, store]);
  return (
    <RowPrStoreContext.Provider value={store}>
      {children}
    </RowPrStoreContext.Provider>
  );
}

/** This row's PR slice. Non-stories and Stories without `prUrl` stay idle. */
export function useRowPrData(issue: IssueRecord): RowPrData {
  const store = useContext(RowPrStoreContext);
  const active = issue.kind === "story" && Boolean(issue.prUrl);
  const issueId = issue.id;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active || !store) return () => {};
      return store.subscribe(issueId, onChange);
    },
    [active, issueId, store],
  );
  const getSnapshot = useCallback(() => {
    if (!active || !store) return IDLE_ROW_PR;
    return store.get(issueId);
  }, [active, issueId, store]);
  // The structure tree is client-rendered. The server snapshot stays idle,
  // matching a Story row before /prs has loaded.
  const rowPr = useSyncExternalStore(subscribe, getSnapshot, () => IDLE_ROW_PR);
  if (!store) {
    throw new Error("useRowPrData requires RowPrStoreProvider");
  }
  return rowPr;
}
