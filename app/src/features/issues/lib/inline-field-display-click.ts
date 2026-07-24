export function shouldBeginInlineEdit({
  richDisplay,
  targetIsLink,
  hasTextSelection,
}: {
  richDisplay: boolean;
  targetIsLink: boolean;
  hasTextSelection: boolean;
}): boolean {
  if (targetIsLink) return false;
  if (richDisplay && hasTextSelection) return false;
  return true;
}
