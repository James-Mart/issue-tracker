const INTERACTIVE_DISPLAY_SELECTOR = "a, img, [data-markdown-image], summary";

export function shouldBeginInlineEdit({
  richDisplay,
  target,
  hasTextSelection,
}: {
  richDisplay: boolean;
  target: EventTarget | null;
  hasTextSelection: boolean;
}): boolean {
  const el = target instanceof Element ? target : null;
  if (richDisplay && el?.closest(INTERACTIVE_DISPLAY_SELECTOR)) return false;
  if (richDisplay && hasTextSelection) return false;
  return true;
}
