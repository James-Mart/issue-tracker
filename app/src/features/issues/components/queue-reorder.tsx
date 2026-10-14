import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReorderQueuePosition } from "../api/mutations";
import type { FlowItem } from "../lib/flow";
import {
  queueDestinationIndex,
  queueDropFromRows,
  type QueueDropPlace,
  type QueueRowBox,
  type QueueRowChrome,
} from "../lib/queue-reorder";

type DropIndicator = { targetId: string; place: QueueDropPlace };

type DragGesture = {
  pointerId: number;
  sourceId: string;
  projectId: string;
  startY: number;
  moved: boolean;
};

type QueueReorderContextValue = {
  draggingId: string | null;
  indicator: DropIndicator | null;
  moveBy: (issueId: string, projectId: string, delta: -1 | 1) => void;
  pointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    issueId: string,
    projectId: string,
  ) => void;
  pointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  pointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

const QueueReorderContext = createContext<QueueReorderContextValue | null>(null);

const DRAG_START_PX = 4;

function waitingIdsByProject(items: readonly FlowItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of items) {
    if (item.queueStage !== "waiting") continue;
    if (item.issue.kind !== "epic" && item.issue.kind !== "story") continue;
    const list = map.get(item.issue.partOf) ?? [];
    list.push(item.issue.id);
    map.set(item.issue.partOf, list);
  }
  return map;
}

function readQueueRows(projectId: string): QueueRowBox[] {
  const selector = `[data-queue-project="${CSS.escape(projectId)}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)].flatMap(
    (row) => {
      const id = row.dataset.queueRow;
      const projectId = row.dataset.queueProject;
      if (!id || !projectId) return [];
      const rect = row.getBoundingClientRect();
      return [{ id, projectId, top: rect.top, bottom: rect.bottom }];
    },
  );
}

/** Drag state for the queue bucket. Waiting rows inside read the chrome. */
export function QueueReorderProvider({
  items,
  children,
}: {
  items: readonly FlowItem[];
  children: ReactNode;
}) {
  const { mutate, isPending } = useReorderQueuePosition();
  const waitingByProject = useMemo(() => waitingIdsByProject(items), [items]);
  const waitingRef = useRef(waitingByProject);
  waitingRef.current = waitingByProject;
  const dragRef = useRef<DragGesture | null>(null);
  const indicatorRef = useRef<DropIndicator | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

  const showIndicator = useCallback((next: DropIndicator | null) => {
    const current = indicatorRef.current;
    if (
      current?.targetId === next?.targetId &&
      current?.place === next?.place
    ) {
      return;
    }
    indicatorRef.current = next;
    setIndicator(next);
  }, []);

  const commit = useCallback(
    (issueId: string, projectId: string, index: number) => {
      const waitingIds = waitingRef.current.get(projectId) ?? [];
      mutate({ id: issueId, index, waitingIds });
    },
    [mutate],
  );

  const moveBy = useCallback(
    (issueId: string, projectId: string, delta: -1 | 1) => {
      if (isPending) return;
      const waitingIds = waitingRef.current.get(projectId) ?? [];
      const at = waitingIds.indexOf(issueId);
      if (at < 0) return;
      const index = at + delta;
      if (index < 0 || index >= waitingIds.length) return;
      commit(issueId, projectId, index);
    },
    [commit, isPending],
  );

  const pointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      issueId: string,
      projectId: string,
    ) => {
      if (event.button !== 0 || isPending) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        sourceId: issueId,
        projectId,
        startY: event.clientY,
        moved: false,
      };
    },
    [isPending],
  );

  const pointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientY - drag.startY) < DRAG_START_PX) {
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
        setDraggingId(drag.sourceId);
      }
      showIndicator(
        queueDropFromRows(
          readQueueRows(drag.projectId),
          event.clientY,
          drag.sourceId,
          drag.projectId,
        ),
      );
    },
    [showIndicator],
  );

  const pointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const drop = indicatorRef.current;
      showIndicator(null);
      setDraggingId(null);
      if (!drag.moved || !drop) return;
      const waitingIds = waitingRef.current.get(drag.projectId) ?? [];
      const index = queueDestinationIndex(
        waitingIds,
        drag.sourceId,
        drop.targetId,
        drop.place,
      );
      if (index == null) return;
      commit(drag.sourceId, drag.projectId, index);
    },
    [commit, showIndicator],
  );

  const value = useMemo(
    () => ({
      draggingId,
      indicator,
      moveBy,
      pointerDown,
      pointerMove,
      pointerUp,
    }),
    [draggingId, indicator, moveBy, pointerDown, pointerMove, pointerUp],
  );

  return (
    <QueueReorderContext.Provider value={value}>
      {children}
    </QueueReorderContext.Provider>
  );
}

export function useQueueRowChrome(
  issueId: string,
  projectId: string,
  waiting: boolean,
): QueueRowChrome | undefined {
  const ctx = useContext(QueueReorderContext);
  if (!ctx || !waiting) return undefined;
  const dropEdge =
    ctx.indicator?.targetId === issueId ? ctx.indicator.place : undefined;
  return {
    dragging: ctx.draggingId === issueId,
    dropEdge,
    rowId: issueId,
    projectId,
  };
}

/** Renders a queue row with drag chrome when this bucket is reorderable. */
export function QueueBucketRow({
  item,
  projectId,
  projectTitle,
  render,
}: {
  item: FlowItem;
  projectId: string;
  projectTitle?: string;
  render: (
    item: FlowItem,
    projectId: string,
    projectTitle: string | undefined,
    chrome: QueueRowChrome | undefined,
  ) => ReactNode;
}) {
  const chrome = useQueueRowChrome(
    item.issue.id,
    projectId,
    item.queueStage === "waiting",
  );
  return render(item, projectId, projectTitle, chrome);
}

/** Grip that drags a waiting root among the other waiting roots in its Project. */
export function QueueDragHandle({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const ctx = useContext(QueueReorderContext);
  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title="Reorder"
      aria-label="Reorder"
      aria-keyshortcuts="ArrowUp ArrowDown"
      data-testid="flow-row-reorder"
      draggable={false}
      className="cursor-grab touch-none active:cursor-grabbing"
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        ctx?.moveBy(issueId, projectId, event.key === "ArrowUp" ? -1 : 1);
      }}
      onPointerDown={(event) => ctx?.pointerDown(event, issueId, projectId)}
      onPointerMove={(event) => ctx?.pointerMove(event)}
      onPointerUp={(event) => ctx?.pointerUp(event)}
      onPointerCancel={(event) => ctx?.pointerUp(event)}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </Button>
  );
}
