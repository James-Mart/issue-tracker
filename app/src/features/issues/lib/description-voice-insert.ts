/** Prepend a space when inserting speech after non-whitespace text. */
export function transcriptTextForCaret(
  draft: string,
  caretStart: number,
  transcript: string,
): string {
  if (
    caretStart > 0 &&
    !/\s/.test(draft.charAt(caretStart - 1))
  ) {
    return ` ${transcript}`;
  }
  return transcript;
}
