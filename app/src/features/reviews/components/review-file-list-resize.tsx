import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import { useReviewFileListWidth } from "../hooks/use-review-file-list-width";
import type { ReviewDiffPane } from "../lib/review-diff-pane";
import {
  MIN_REVIEW_FILE_LIST_WIDTH,
} from "../lib/review-file-list-width";

function ReviewFileListResizeHandle({
  width,
  maxWidth,
  onPointerResize,
  onPointerResizeEnd,
  onStep,
  onReset,
}: {
  width: number;
  maxWidth: number;
  onPointerResize: (clientX: number) => number | undefined;
  onPointerResizeEnd: () => void;
  onStep: (direction: -1 | 1) => void;
  onReset: () => void;
}) {
  const dragRef = useRef<{ pointerId: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, moved: false };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved = true;
    const applied = onPointerResize(event.clientX);
    if (applied != null) {
      event.currentTarget.setAttribute("aria-valuenow", String(applied));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) onPointerResizeEnd();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onStep(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onStep(1);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file list"
      aria-controls="review-file-list"
      aria-valuemin={MIN_REVIEW_FILE_LIST_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="review-file-list-resize"
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group relative hidden w-3 shrink-0 cursor-col-resize touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shell:flex shell:items-center shell:justify-center"
    >
      <span
        aria-hidden
        data-testid="review-file-list-resize-grip"
        className={cn(
          "pointer-events-none h-8 w-1 rounded-full bg-[hsl(var(--rail-lit))] transition-colors duration-150 motion-reduce:transition-none",
          "group-hover:bg-primary group-focus-visible:bg-primary",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}

/**
 * Desktop row: file list, resize handle, diff. Below `shell`, `pane` shows
 * one of them; `shell:` puts both back. The handle stays `hidden` until `shell`.
 */
export function ReviewFileListLayout({
  tree,
  children,
  pane,
  paneTabs,
}: {
  tree: ReactNode;
  children: ReactNode;
  pane: ReviewDiffPane;
  /** Phone Files/Code tabs are showing, so the columns are those tabs' panels. */
  paneTabs: boolean;
}) {
  const splitRef = useRef<HTMLDivElement>(null);
  const fileList = useReviewFileListWidth(splitRef);

  return (
    <div
      ref={splitRef}
      data-testid="review-diff-columns"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 shell:flex-row shell:gap-0"
      style={
        {
          "--review-file-list-width": `${fileList.width}px`,
        } as CSSProperties
      }
    >
      <div
        id="review-file-list"
        role={paneTabs ? "tabpanel" : undefined}
        aria-labelledby={paneTabs ? "review-diff-pane-files-tab" : undefined}
        data-testid="review-diff-files"
        className={cn(
          "min-w-0 pb-4 shell:min-h-0 shell:w-[var(--review-file-list-width)] shell:shrink-0 shell:overflow-y-auto shell:pb-0",
          pane === "code" && "hidden shell:block",
        )}
      >
        {tree}
      </div>
      <ReviewFileListResizeHandle
        width={fileList.width}
        maxWidth={fileList.maxWidth}
        onPointerResize={fileList.resizeToPointer}
        onPointerResizeEnd={fileList.resizeEnd}
        onStep={fileList.step}
        onReset={fileList.reset}
      />
      <div
        id="review-diff-code"
        role={paneTabs ? "tabpanel" : undefined}
        aria-labelledby={paneTabs ? "review-diff-pane-code-tab" : undefined}
        data-testid="review-diff-code"
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          pane === "files" && "hidden shell:flex",
        )}
      >
        {children}
      </div>
    </div>
  );
}
