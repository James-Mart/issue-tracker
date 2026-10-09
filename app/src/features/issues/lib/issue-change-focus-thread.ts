import { useLayoutEffect, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { CommentThread } from "./comment-threads";
import { readDiffThreadSearchParam } from "./issue-detail-tabs";

export function fileNameForAnchorPath(
  files: Pick<FileDiffMetadata, "name" | "prevName">[],
  path: string,
): string | undefined {
  return files.find((file) => file.name === path || file.prevName === path)
    ?.name;
}

export function threadNodeInPanel(
  panel: ParentNode,
  threadId: string,
): HTMLElement | null {
  const node = panel.querySelector(
    `[data-thread-root="${CSS.escape(threadId)}"]`,
  );
  return node instanceof HTMLElement ? node : null;
}

function scrollWhenMounted(
  find: () => HTMLElement | null,
  options: ScrollIntoViewOptions,
): () => void {
  const scroll = () => {
    const node = find();
    if (!node) return false;
    node.scrollIntoView(options);
    return true;
  };
  if (scroll()) return () => undefined;
  const frame = requestAnimationFrame(() => {
    scroll();
  });
  return () => cancelAnimationFrame(frame);
}

/** Scroll the thread card into view, retrying once if it is not mounted yet. */
export function scrollThreadNodeInPanel(
  panel: ParentNode,
  threadId: string,
  options: ScrollIntoViewOptions,
): () => void {
  return scrollWhenMounted(() => threadNodeInPanel(panel, threadId), options);
}

/** Scroll a comment, falling back to its thread card, retrying once if it is not mounted yet. */
export function scrollCommentInPanel(
  panel: ParentNode,
  commentId: string,
  threadId: string,
  options: ScrollIntoViewOptions,
): () => void {
  return scrollWhenMounted(() => {
    const comment = panel.querySelector(
      `[data-comment-id="${CSS.escape(commentId)}"]`,
    );
    return comment instanceof HTMLElement
      ? comment
      : threadNodeInPanel(panel, threadId);
  }, options);
}

/** Select the thread's file and scroll its inline block into view. */
export function useFocusDiffThread(args: {
  files: Pick<FileDiffMetadata, "name" | "prevName">[];
  threads: CommentThread[];
  selectedName: string | undefined;
  setSelectedName: (name: string) => void;
  panelRef: RefObject<HTMLElement | null>;
}): string | null {
  const [searchParams] = useSearchParams();
  const threadId = readDiffThreadSearchParam(searchParams);
  const focusPath = args.threads.find((thread) => thread.root.id === threadId)
    ?.root.anchor?.path;
  const focusFile =
    focusPath !== undefined
      ? fileNameForAnchorPath(args.files, focusPath)
      : undefined;

  useLayoutEffect(() => {
    if (focusFile == null || args.selectedName === focusFile) return;
    args.setSelectedName(focusFile);
  }, [args.selectedName, args.setSelectedName, focusFile]);

  useLayoutEffect(() => {
    if (threadId == null) return;
    const panel = args.panelRef.current;
    if (panel == null) return;
    return scrollThreadNodeInPanel(panel, threadId, {
      block: "nearest",
      inline: "nearest",
    });
  }, [args.files, args.panelRef, args.threads, threadId]);

  return threadId;
}
