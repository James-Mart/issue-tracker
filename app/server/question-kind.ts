/** Fields stored on a new question root. Absent for a review root. */
export function questionKindFields(
  kind?: "question",
): { kind: "question" } | Record<string, never> {
  return kind === "question" ? { kind: "question" } : {};
}
