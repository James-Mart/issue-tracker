import type { CommentMessage } from "@server/schemas";

export const SNIPPET_CONTEXT_LINES = 3;

export type AnchorSnippetLine = {
  line: number;
  text: string;
  anchored: boolean;
};

export function fileContentLines(contents: string): string[] {
  if (contents === "") return [];
  const lines = contents.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function anchorLineRange(
  anchor: Pick<NonNullable<CommentMessage["anchor"]>, "line" | "startLine">,
): { start: number; end: number } {
  const end = anchor.line;
  const start = anchor.startLine ?? end;
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

/** Compact window of file-at-sha lines around the anchored range. */
export function snippetLinesFromContents(
  contents: string,
  anchor: Pick<NonNullable<CommentMessage["anchor"]>, "line" | "startLine">,
  context = SNIPPET_CONTEXT_LINES,
): AnchorSnippetLine[] {
  const lines = fileContentLines(contents);
  if (lines.length === 0) return [];
  const { start, end } = anchorLineRange(anchor);
  const from = Math.max(1, start - context);
  const to = Math.min(lines.length, end + context);
  const snippet: AnchorSnippetLine[] = [];
  for (let line = from; line <= to; line++) {
    snippet.push({
      line,
      text: lines[line - 1]!,
      anchored: line >= start && line <= end,
    });
  }
  return snippet;
}
