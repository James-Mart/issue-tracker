/** Insert `insert` at caret; when start/end are nullish, append at end. */
export function insertTextAtCaret(
  value: string,
  insert: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start =
    typeof selectionStart === "number" && selectionStart >= 0
      ? selectionStart
      : value.length;
  const end =
    typeof selectionEnd === "number" && selectionEnd >= 0
      ? selectionEnd
      : start;
  const next = value.slice(0, start) + insert + value.slice(end);
  const caret = start + insert.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}
