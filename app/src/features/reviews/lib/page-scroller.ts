/** The element that scrolls the review page on a phone. */
export function pageScroller(): HTMLElement {
  const el = document.scrollingElement;
  if (!(el instanceof HTMLElement)) {
    throw new Error("review page scroll: the page has no scrolling element");
  }
  return el;
}
