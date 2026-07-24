import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { IssueRecord } from "@server/schemas";
import { useMoveStory, useReorderBoardChild } from "../api/mutations";
import { canDropStoryOntoProject, readStoryDragId, STORY_DRAG_MIME } from "../lib/story-drop";
import {
  isRowDraggable,
  processStoryDrop,
  resolveDropAction,
} from "../lib/story-tree-dnd-logic";

export type RowDnDProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  | "draggable"
  | "onDragStart"
  | "onDragEnd"
  | "onDragOver"
  | "onDragLeave"
  | "onDrop"
> & {
  isDragging: boolean;
  isDropTarget: boolean;
};

export interface StoryTreeDnD {
  getRowDnDProps: (issue: IssueRecord) => RowDnDProps;
  getProjectDnDProps: (projectId: string) => RowDnDProps;
  /** Id of the row currently being dragged, if any. */
  draggingId: string | null;
  /** True once if the last gesture was a drag (clears the flag). */
  consumeDragGesture: () => boolean;
}

const StoryTreeDnDContext = createContext<StoryTreeDnD | null>(null);

const INERT_ROW_DND: RowDnDProps = {
  isDragging: false,
  isDropTarget: false,
};

export function useStoryTreeDnD(issues: IssueRecord[]): StoryTreeDnD {
  const moveStory = useMoveStory();
  const reorderBoard = useReorderBoardChild();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const draggedDuringGestureRef = useRef(false);

  const clearDrag = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  const runDrop = useCallback(
    (sourceId: string, targetId: string) => {
      const action = resolveDropAction(issues, sourceId, targetId);
      if (action === "restack" || action === "reparent") {
        moveStory.mutate({ id: sourceId, target: targetId });
        return;
      }
      if (action === "reorder") {
        reorderBoard.mutate({ id: sourceId, before: targetId });
      }
    },
    [issues, moveStory, reorderBoard],
  );

  const dropTargetHandlers = useCallback(
    (
      targetId: string,
      canDrop: (sourceId: string) => boolean,
    ): Pick<
      HTMLAttributes<HTMLDivElement>,
      "onDragOver" | "onDragLeave" | "onDrop"
    > => ({
      onDragOver: (event: DragEvent) => {
        const sourceId = draggingIdRef.current;
        if (!sourceId) return;
        if (!canDrop(sourceId)) {
          setDropTargetId((current) => (current === targetId ? null : current));
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTargetId(targetId);
      },
      onDragLeave: () => {
        setDropTargetId((current) => (current === targetId ? null : current));
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        const sourceId =
          readStoryDragId(event.dataTransfer) ?? draggingIdRef.current;
        clearDrag();
        processStoryDrop({
          sourceId,
          targetId,
          canDrop,
          onMove: runDrop,
        });
      },
    }),
    [clearDrag, runDrop],
  );

  const dragSourceHandlers = useCallback(
    (id: string): Pick<
      HTMLAttributes<HTMLDivElement>,
      "draggable" | "onDragStart" | "onDragEnd"
    > => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.setData(STORY_DRAG_MIME, id);
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        draggedDuringGestureRef.current = true;
        draggingIdRef.current = id;
        setDraggingId(id);
        setDropTargetId(null);
      },
      onDragEnd: clearDrag,
    }),
    [clearDrag],
  );

  const getRowDnDProps = useCallback(
    (issue: IssueRecord): RowDnDProps => {
      const id = issue.id;
      const isDropTarget = dropTargetId === id;

      if (!isRowDraggable(issue, issues)) {
        return INERT_ROW_DND;
      }

      const canDrop = (sourceId: string) =>
        resolveDropAction(issues, sourceId, id) !== null;
      return {
        ...dropTargetHandlers(id, canDrop),
        ...dragSourceHandlers(id),
        isDragging: draggingId === id,
        isDropTarget,
      };
    },
    [
      dragSourceHandlers,
      draggingId,
      dropTargetHandlers,
      dropTargetId,
      issues,
    ],
  );

  const getProjectDnDProps = useCallback(
    (projectId: string): RowDnDProps => {
      const isDropTarget = dropTargetId === projectId;
      return {
        ...dropTargetHandlers(projectId, (sourceId) =>
          canDropStoryOntoProject(issues, sourceId, projectId),
        ),
        isDragging: false,
        isDropTarget,
      };
    },
    [dropTargetHandlers, dropTargetId, issues],
  );

  const consumeDragGesture = useCallback(() => {
    if (!draggedDuringGestureRef.current) return false;
    draggedDuringGestureRef.current = false;
    return true;
  }, []);

  return {
    getRowDnDProps,
    getProjectDnDProps,
    draggingId,
    consumeDragGesture,
  };
}

export function StoryTreeDnDProvider({
  value,
  children,
}: {
  value: StoryTreeDnD;
  children: ReactNode;
}) {
  return (
    <StoryTreeDnDContext.Provider value={value}>
      {children}
    </StoryTreeDnDContext.Provider>
  );
}

export function useStoryTreeDnDContext(): StoryTreeDnD {
  const ctx = useContext(StoryTreeDnDContext);
  if (!ctx) {
    throw new Error("useStoryTreeDnDContext requires StoryTreeDnDProvider");
  }
  return ctx;
}
