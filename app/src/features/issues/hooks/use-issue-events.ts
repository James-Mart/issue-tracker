import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { IssueEvent } from "@server/schemas";
import { issuesKeys } from "../api/keys";

const RECONNECT_DELAY_MS = 2_000;
// The server sends a `ping` every 10s; if none arrives within this window the
// connection is treated as dead (e.g. a dev-proxy zombie after a backend
// restart, which never fires an `error`) and forcibly reconnected.
const HEARTBEAT_TIMEOUT_MS = 25_000;
// Cascade writes (e.g. archived) emit one SSE event per issue.json. Coalesce
// list refetches so a deep subtree does not slam the list query N times.
const LIST_INVALIDATE_DEBOUNCE_MS = 50;

function parseEvent(data: string): IssueEvent | null {
  try {
    const parsed = JSON.parse(data) as Partial<IssueEvent>;
    if (!parsed.id || !parsed.type) return null;
    return {
      type: parsed.type,
      id: parsed.id,
      scope:
        parsed.scope === "chat"
          ? "chat"
          : parsed.scope === "attachments"
            ? "attachments"
            : "issue",
    };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("ignoring malformed issue event:", data, err);
    }
    return null;
  }
}

export function useIssueEvents(): void {
  const qc = useQueryClient();

  useEffect(() => {
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
      if (event.scope === "chat") {
        qc.invalidateQueries({ queryKey: issuesKeys.chat(event.id) });
        return;
      }
      if (event.scope === "attachments") {
        qc.invalidateQueries({ queryKey: issuesKeys.attachments(event.id) });
        return;
      }
      scheduleListInvalidate();
      if (event.type === "unlink-dir") {
        qc.removeQueries({ queryKey: issuesKeys.detail(event.id) });
        qc.removeQueries({ queryKey: issuesKeys.chat(event.id) });
        qc.removeQueries({ queryKey: issuesKeys.attachments(event.id) });
      } else {
        qc.invalidateQueries({ queryKey: issuesKeys.detail(event.id) });
      }
    };

    const closeSource = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      source?.close();
      source = null;
    };

    const scheduleReconnect = () => {
      closeSource();
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(scheduleReconnect, HEARTBEAT_TIMEOUT_MS);
    };

    function connect() {
      source = new EventSource("/api/events");
      armWatchdog();
      source.addEventListener("open", () => {
        armWatchdog();
        resync();
      });
      source.addEventListener("ping", armWatchdog);
      source.addEventListener("issue", (raw) => {
        armWatchdog();
        const event = parseEvent((raw as MessageEvent).data);
        if (event) applyEvent(event);
      });
      source.onerror = scheduleReconnect;
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (listInvalidateTimer) clearTimeout(listInvalidateTimer);
      closeSource();
    };
  }, [qc]);
}
