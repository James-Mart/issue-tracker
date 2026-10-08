import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { IssueRecord } from "@server/schemas";
import { ApiError } from "@/lib/api/errors";
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import { issuesById } from "../lib/build-tree";
import { missingChainIds } from "../lib/archived-issue-list";

function MissingIssueRecord({
  id,
  onRecord,
  onMissing,
}: {
  id: string;
  onRecord: (issue: IssueRecord) => void;
  onMissing: (id: string, message?: string) => void;
}) {
  const { data, error } = useIssueDetailQuery(id);
  useEffect(() => {
    if (data) onRecord(data);
  }, [data, onRecord]);
  useEffect(() => {
    if (!error) return;
    const missing = error instanceof ApiError && error.status === 404;
    onMissing(id, missing ? undefined : error.message);
  }, [error, id, onMissing]);
  return null;
}

/** Mounts per-issue reads only when something in the chain is still missing. */
export function IssueLinkResolution({
  missingIds,
  accept,
  reject,
}: {
  missingIds: readonly string[];
  accept: (issue: IssueRecord) => void;
  reject: (id: string, message?: string) => void;
}) {
  if (missingIds.length === 0) return null;
  return (
    <MissingIssueRecords
      ids={missingIds}
      onRecord={accept}
      onMissing={reject}
    />
  );
}

/** Per-issue reads for archived (or otherwise unlisted) ids and ancestors. */
export function MissingIssueRecords({
  ids,
  onRecord,
  onMissing,
}: {
  ids: readonly string[];
  onRecord: (issue: IssueRecord) => void;
  onMissing: (id: string, message?: string) => void;
}) {
  return (
    <Fragment>
      {ids.map((id) => (
        <MissingIssueRecord
          key={id}
          id={id}
          onRecord={onRecord}
          onMissing={onMissing}
        />
      ))}
    </Fragment>
  );
}

export type IssueSupplement = {
  byId: Map<string, IssueRecord>;
  missingIds: readonly string[];
  failedIds: ReadonlySet<string>;
  accept: (issue: IssueRecord) => void;
  reject: (id: string, message?: string) => void;
  listReady: boolean;
  messageFor: (id: string) => string | undefined;
};

/**
 * Issue map from `baseIssues` or the default list, plus records loaded by
 * id when a root or its ancestor is missing from that map.
 */
export function useSupplementedById(
  rootIds: readonly string[],
  seed?: IssueRecord,
  baseIssues?: readonly IssueRecord[],
  ancestors = false,
): IssueSupplement {
  const { data } = useIssuesQuery(undefined, {
    enabled: baseIssues === undefined,
  });
  const [extra, setExtra] = useState<ReadonlyMap<string, IssueRecord>>(
    () => new Map(),
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedMessages, setFailedMessages] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const accept = useCallback((issue: IssueRecord) => {
    setExtra((prev) => {
      if (prev.get(issue.id) === issue) return prev;
      const next = new Map(prev);
      next.set(issue.id, issue);
      return next;
    });
  }, []);
  const reject = useCallback((id: string, message?: string) => {
    setFailedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (!message) return;
    setFailedMessages((prev) => {
      if (prev.get(id) === message) return prev;
      const next = new Map(prev);
      next.set(id, message);
      return next;
    });
  }, []);
  const messageFor = useCallback(
    (id: string) => failedMessages.get(id),
    [failedMessages],
  );
  const rootKey = rootIds.join("\0");
  const byId = useMemo(() => {
    const map = issuesById([...(baseIssues ?? data?.issues ?? [])]);
    if (seed) map.set(seed.id, seed);
    for (const issue of extra.values()) map.set(issue.id, issue);
    return map;
  }, [baseIssues, data?.issues, seed, extra]);
  const missingIds = useMemo(() => {
    if (!data && baseIssues === undefined) return [];
    const ids = rootKey ? rootKey.split("\0") : [];
    return missingChainIds(ids, byId, ancestors);
  }, [ancestors, data, baseIssues, rootKey, byId]);
  return {
    byId,
    missingIds,
    failedIds,
    accept,
    reject,
    listReady: Boolean(data) || baseIssues !== undefined,
    messageFor,
  };
}
