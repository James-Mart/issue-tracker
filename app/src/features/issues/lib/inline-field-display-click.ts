export function richDisplayInteractiveTarget(target: EventTarget | null): {
  targetIsLink: boolean;
  targetIsImage: boolean;
} {
  const el = target instanceof HTMLElement ? target : null;
  return {
    targetIsLink: Boolean(el?.closest("a")),
    targetIsImage: Boolean(el?.closest("img, [data-markdown-image]")),
  };
}

export function shouldBeginInlineEdit({
  richDisplay,
  targetIsLink,
  targetIsImage,
  hasTextSelection,
}: {
  richDisplay: boolean;
  targetIsLink: boolean;
  targetIsImage: boolean;
  hasTextSelection: boolean;
}): boolean {
  if (targetIsLink || targetIsImage) return false;
  if (richDisplay && hasTextSelection) return false;
  return true;
}
