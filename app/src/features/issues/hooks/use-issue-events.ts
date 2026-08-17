import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { IssueEvent } from "@server/schemas";
import {
  subscribeTopic,
  type TopicMessage,
} from "@/lib/ws/transport";
import { issuesKeys } from "../api/keys";

// Cascade writes (e.g. archived) emit one event per issue.json. Coalesce
// list refetches so a deep subtree does not slam the list query N times.
const LIST_INVALIDATE_DEBOUNCE_MS = 50;
const ISSUES_TOPIC = "issues";

function parseEvent(data: unknown): IssueEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const parsed = data as Partial<IssueEvent>;
  if (!parsed.id || !parsed.type) return null;
  const scope =
    parsed.scope === "comments"
      ? "comments"
      : parsed.scope === "attachments"
        ? "attachments"
        : parsed.scope === "planning-run"
          ? "planning-run"
          : "issue";
  return {
    type: parsed.type,
    id: parsed.id,
    scope,
  };
}

export function useIssueEvents(): void {
  const qc = useQueryClient();

  useEffect(() => {
    let listInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const resync = () => qc.invalidateQueries({ queryKey: issuesKeys.all });

    const scheduleListInvalidate = () => {
      if (listInvalidateTimer) clearTimeout(listInvalidateTimer);
      listInvalidateTimer = setTimeout(() => {
        listInvalidateTimer = null;
        if (!disposed) {
          qc.invalidateQueries({ queryKey: issuesKeys.list() });
        }
      }, LIST_INVALIDATE_DEBOUNCE_MS);
    };

    const applyEvent = (event: IssueEvent) => {
      if (event.scope === "comments") {
        qc.invalidateQueries({ queryKey: issuesKeys.comments(event.id) });
        return;
      }
      if (event.scope === "attachments") {
        qc.invalidateQueries({ queryKey: issuesKeys.attachments(event.id) });
        return;
      }
      if (event.scope === "planning-run") {
        scheduleListInvalidate();
        qc.invalidateQueries({ queryKey: issuesKeys.detail(event.id) });
        return;
      }
      scheduleListInvalidate();
      if (event.type === "unlink-dir") {
        qc.removeQueries({ queryKey: issuesKeys.detail(event.id) });
        qc.removeQueries({ queryKey: issuesKeys.comments(event.id) });
        qc.removeQueries({ queryKey: issuesKeys.attachments(event.id) });
      } else {
        qc.invalidateQueries({ queryKey: issuesKeys.detail(event.id) });
      }
    };

    const onMessage = (message: TopicMessage) => {
      if (disposed) return;
      if (message.type === "reset") {
        resync();
        return;
      }
      const event = parseEvent(message.event);
      if (event) applyEvent(event);
    };

    const unsubscribe = subscribeTopic(ISSUES_TOPIC, onMessage);

    return () => {
      disposed = true;
      if (listInvalidateTimer) clearTimeout(listInvalidateTimer);
      unsubscribe();
    };
  }, [qc]);
}
