import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { applyAutoscroll, isScrollPinned, scrollToBottom } from "@/components/ui/message-scroller";
import { pageScroller } from "../lib/page-scroller";

function mounted(ref: RefObject<HTMLDivElement | null>, part: string): HTMLDivElement {
  if (!ref.current) {
    throw new Error(`agents list scroll: the ${part} is not mounted while the list is shown`);
  }
  return ref.current;
}

/**
 * Scroll only `list` so `card` is in view from the nearer edge. `scrollIntoView`
 * would also scroll the page under the fixed review header.
 */
function revealInList(list: HTMLElement, card: HTMLElement): void {
  const view = list.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const above = box.top - view.top;
  const below = box.bottom - view.bottom;
  if (above < 0) {
    list.scrollTop += above;
  } else if (below > 0) {
    // A card taller than the list stops with its top in view.
    list.scrollTop += Math.min(below, above);
  }
}

/**
 * Agents tab scrolling. The list opens on the newest run; with a focused run,
 * the wide list brings that card into view instead. It then follows new runs,
 * growing transcripts, and a scroller resized by the review header or the
 * window, only while the reader sits at the bottom. The wide list scrolls
 * itself; a phone scrolls the page.
 *
 * `wide` is undefined until the viewport is measured, and the list opens once
 * it is known. `shownRuns` is the runs the list renders, or null while it
 * shows none; while non-null, `listRef` must be on the list and `contentRef`
 * on the element holding the cards. Put `focusedCardRef` on the focused run's
 * card. Call `stayWithToggledCard` when the reader opens or closes a card, so
 * its transcript loading in does not pull the view away.
 */
export function useReviewAgentsListScroll(
  wide: boolean | undefined,
  focusedRunId: string | null,
  shownRuns: readonly unknown[] | null,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusedCard = useRef<HTMLDivElement | null>(null);
  const opened = useRef(false);
  const pinned = useRef(false);
  const revealedRunId = useRef<string | null>(null);
  const listShown = shownRuns !== null;

  const focusedCardRef = useCallback((node: HTMLDivElement | null) => {
    focusedCard.current = node;
  }, []);

  useLayoutEffect(() => {
    if (opened.current || wide === undefined || !listShown) return;
    const list = mounted(listRef, "list");
    opened.current = true;
    if (focusedRunId) return;
    scrollToBottom(wide ? list : pageScroller());
    pinned.current = true;
  }, [wide, focusedRunId, listShown]);

  useLayoutEffect(() => {
    if (wide !== true || !focusedRunId || revealedRunId.current === focusedRunId) return;
    const card = focusedCard.current;
    // The focused run has not reached the list yet; a later poll brings it.
    if (!card) return;
    revealedRunId.current = focusedRunId;
    revealInList(mounted(listRef, "list"), card);
  }, [wide, focusedRunId, shownRuns]);

  useEffect(() => {
    if (wide === undefined || !listShown) return;
    const list = mounted(listRef, "list");
    const content = mounted(contentRef, "card content");
    const scroller = wide ? list : pageScroller();
    const source: HTMLElement | Window = wide ? list : window;
    const track = () => {
      pinned.current = isScrollPinned(scroller);
    };
    const follow = () => applyAutoscroll(scroller, pinned.current);
    source.addEventListener("scroll", track, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(scroller);
    return () => {
      source.removeEventListener("scroll", track);
      observer.disconnect();
    };
  }, [wide, listShown]);

  const stayWithToggledCard = useCallback(() => {
    pinned.current = false;
  }, []);

  return { listRef, contentRef, focusedCardRef, stayWithToggledCard };
}
