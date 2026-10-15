/**
 * Place a proposal in the standards file as it reads now.
 *
 * A unique replacement is the whole file before and after that edit.
 * An empty `before` inserts `after` at the end of the named section,
 * immediately before the next heading at the same level or higher.
 * Zero matches or more than one match is the excerpt: the card diffs
 * `before` and `after` with no file surroundings.
 * `applyPureAddition` returns that same end as a 1-based line for apply.
 */
export type StandardsProposalDiffResolution =
  | { kind: "excerpt" }
  | { kind: "anchored"; oldText: string; newText: string };

const ATX = /^(?: {0,3})(#{1,6})[ \t]+(.*)$/;
const FENCE = /^(?: {0,3})(`{3,}|~{3,})(.*)$/;

type Heading = {
  level: number;
  text: string;
  /** Character offset in the file where the heading line begins. */
  start: number;
};

type Fence = { char: string; length: number };

function headingText(raw: string): string {
  return raw.trim().replace(/[ \t]+#+\s*$/, "").trim();
}

function fenceAt(line: string, open: Fence | undefined): Fence | undefined | "close" {
  const match = FENCE.exec(line);
  if (!match) return open;
  const marker = match[1]!;
  const info = match[2] ?? "";
  if (!open) return { char: marker[0]!, length: marker.length };
  if (marker[0] === open.char && marker.length >= open.length && info.trim() === "") {
    return "close";
  }
  return open;
}

function headings(fileText: string): Heading[] {
  const found: Heading[] = [];
  let fence: Fence | undefined;
  let start = 0;
  const visit = (line: string, lineStart: number) => {
    const next = fenceAt(line, fence);
    if (next === "close") {
      fence = undefined;
      return;
    }
    if (next) {
      fence = next;
      return;
    }
    if (fence) return;
    const match = ATX.exec(line);
    if (!match) return;
    const text = headingText(match[2] ?? "");
    if (!text) return;
    found.push({ level: match[1]!.length, text, start: lineStart });
  };

  for (let i = 0; i < fileText.length; i++) {
    if (fileText[i] !== "\n") continue;
    visit(fileText.slice(start, i).replace(/\r$/, ""), start);
    start = i + 1;
  }
  if (start < fileText.length) visit(fileText.slice(start).replace(/\r$/, ""), start);
  return found;
}

function sectionBody(
  fileText: string,
  section: string,
): { start: number; end: number } | undefined {
  const name = section.trim();
  if (!name) return undefined;
  const all = headings(fileText);
  const matches = all.filter((heading) => heading.text === name);
  if (matches.length !== 1) return undefined;
  const heading = matches[0]!;
  const later = all.find(
    (candidate) => candidate.start > heading.start && candidate.level <= heading.level,
  );
  return { start: heading.start, end: later?.start ?? fileText.length };
}

function fileNewline(fileText: string): string {
  return fileText.includes("\r\n") ? "\r\n" : "\n";
}

/** Keep the addition on its own lines so the heading after the anchor stays a context line. */
function insertOnOwnLines(fileText: string, index: number, addition: string): string {
  let prefix = fileText.slice(0, index);
  const suffix = fileText.slice(index);
  let text = addition;
  const newline = fileNewline(fileText);
  if (prefix.length > 0 && !prefix.endsWith("\n")) prefix += newline;
  if (suffix.length > 0 && !text.endsWith("\n")) text += newline;
  return prefix + text + suffix;
}

/**
 * 1-based line where text inserted at `index` begins.
 * A mid-line index starts on the following line, matching `insertOnOwnLines`.
 */
function additionAnchorLine(fileText: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (fileText[i] === "\n") line++;
  }
  const atLineStart = index === 0 || fileText[index - 1] === "\n";
  return atLineStart ? line : line + 1;
}

type SectionAnchor = {
  start: number;
  end: number;
  additionLine: number;
};

/** The named section, plus the line where a pure addition at its end begins. */
function sectionAnchor(fileText: string, section: string): SectionAnchor | undefined {
  const body = sectionBody(fileText, section);
  if (!body) return undefined;
  return {
    start: body.start,
    end: body.end,
    additionLine: additionAnchorLine(fileText, body.end),
  };
}

/**
 * Line of the addition anchor for an accepted pure addition, in `fileText`
 * as it reads at apply time. The addition starts at `line`, immediately
 * before the next heading at the same level or higher, or on the line
 * after the file when the section runs to the end.
 */
export function applyPureAddition(input: {
  section: string;
  after: string;
  fileText: string;
}): { line: number } {
  if (input.after.length === 0) {
    throw new Error("a pure addition needs after text");
  }
  const anchor = sectionAnchor(input.fileText, input.section);
  if (!anchor) {
    throw new Error(
      `section "${input.section.trim()}" is not a unique heading in the standards file`,
    );
  }
  return { line: anchor.additionLine };
}

/** Index of `needle` when it occurs once, otherwise undefined. */
function onlyOccurrence(haystack: string, needle: string): number | undefined {
  const first = haystack.indexOf(needle);
  if (first < 0) return undefined;
  if (haystack.indexOf(needle, first + needle.length) >= 0) return undefined;
  return first;
}

export function resolveStandardsProposalDiff(input: {
  section: string;
  before: string;
  after: string;
  fileText: string;
}): StandardsProposalDiffResolution {
  const anchor = sectionAnchor(input.fileText, input.section);
  if (!anchor) return { kind: "excerpt" };

  if (input.before.length === 0) {
    return {
      kind: "anchored",
      oldText: input.fileText,
      newText: insertOnOwnLines(input.fileText, anchor.end, input.after),
    };
  }

  const slice = input.fileText.slice(anchor.start, anchor.end);
  if (onlyOccurrence(slice, input.before) === undefined) return { kind: "excerpt" };
  return {
    kind: "anchored",
    oldText: input.fileText,
    newText:
      input.fileText.slice(0, anchor.start) +
      slice.replace(input.before, input.after) +
      input.fileText.slice(anchor.end),
  };
}
