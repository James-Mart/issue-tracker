import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Promote Markdown `details` / `summary` into elements.
 * Every other raw tag stays an html node so the renderer escapes it as text.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  data?: {
    hName?: string;
  };
};

type HtmlTag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Index just after `>` in the scanned string. */
  end: number;
};

type DetailsRegion = {
  start: number;
  end: number;
};

type Piece = { kind: "raw"; text: string } | { kind: "node"; node: MdastNode };

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function isLineStart(source: string, index: number): boolean {
  return index === 0 || source[index - 1] === "\n";
}

function skipFencedCode(source: string, index: number): number | null {
  let cursor = index;
  let spaces = 0;
  while (spaces < 3 && source[cursor] === " ") {
    spaces += 1;
    cursor += 1;
  }
  const marker = source[cursor];
  if (marker !== "`" && marker !== "~") return null;
  let count = 0;
  while (source[cursor] === marker) {
    count += 1;
    cursor += 1;
  }
  if (count < 3) return null;
  const lineBreak = source.indexOf("\n", cursor);
  const info = source.slice(cursor, lineBreak === -1 ? source.length : lineBreak);
  if (marker === "`" && info.includes("`")) return null;
  if (lineBreak === -1) return source.length;
  const close = new RegExp(`^ {0,3}\\${marker}{${count},}[ \\t]*$`);
  let line = lineBreak + 1;
  while (line < source.length) {
    const next = source.indexOf("\n", line);
    const text = source.slice(line, next === -1 ? source.length : next).replace(/\r$/, "");
    if (close.test(text)) return next === -1 ? source.length : next + 1;
    if (next === -1) return source.length;
    line = next + 1;
  }
  return source.length;
}

function skipInlineCode(source: string, index: number): number | null {
  if (source[index] !== "`") return null;
  let count = 0;
  while (source[index + count] === "`") count += 1;
  if (count >= 3 && isLineStart(source, index)) return null;
  const closer = "`".repeat(count);
  let from = index + count;
  while (from < source.length) {
    const found = source.indexOf(closer, from);
    if (found === -1) return null;
    if (source[found + count] !== "`") return found + count;
    from = found + 1;
  }
  return null;
}

function isNameChar(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || (char >= "0" && char <= "9");
}

/** Read a `details` or `summary` tag at `index`. Other tags are ignored. */
function readHtmlTag(source: string, index: number): HtmlTag | null {
  if (source[index] !== "<") return null;
  let cursor = index + 1;
  if (source[cursor] === "!") return null;
  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < source.length && isNameChar(source[cursor] ?? "")) cursor += 1;
  if (cursor === nameStart) return null;
  const name = source.slice(nameStart, cursor).toLowerCase();
  if (name !== "details" && name !== "summary") return null;
  let quote: "'" | '"' | null = null;
  let selfClosing = false;
  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    if (quote) {
      if (char === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === "/") {
      let look = cursor + 1;
      while (look < source.length && (source[look] === " " || source[look] === "\t" || source[look] === "\n" || source[look] === "\r")) {
        look += 1;
      }
      if (source[look] === ">") selfClosing = true;
      cursor += 1;
      continue;
    }
    if (char === ">") {
      cursor += 1;
      return { name, closing, selfClosing: selfClosing && !closing, end: cursor };
    }
    cursor += 1;
  }
  return null;
}

function scanHtmlTags(
  source: string,
  base: number,
  onTag: (tag: HtmlTag, start: number, end: number) => void,
) {
  let index = 0;
  while (index < source.length) {
    if (isLineStart(source, index)) {
      const fenceEnd = skipFencedCode(source, index);
      if (fenceEnd !== null && fenceEnd > index) {
        index = fenceEnd;
        continue;
      }
    }
    const codeEnd = skipInlineCode(source, index);
    if (codeEnd !== null && codeEnd > index) {
      index = codeEnd;
      continue;
    }
    const tag = source[index] === "<" ? readHtmlTag(source, index) : null;
    if (tag) {
      onTag(tag, base + index, base + tag.end);
      index = tag.end;
      continue;
    }
    index += 1;
  }
}

function htmlNodes(node: MdastNode, out: MdastNode[] = []): MdastNode[] {
  if (node.type === "code" || node.type === "inlineCode") return out;
  if (node.type === "html") {
    out.push(node);
    return out;
  }
  for (const child of node.children ?? []) htmlNodes(child, out);
  return out;
}

type SummarySpan = {
  elementStart: number;
  elementEnd: number;
  innerStart: number;
  innerEnd: number;
};

/** The details element's own summary, ignoring summaries in nested details. */
function summaryInDetails(inner: string): SummarySpan | null {
  let detailsDepth = 0;
  let elementStart = -1;
  let innerStart = -1;
  let found: SummarySpan | null = null;
  scanHtmlTags(inner, 0, (tag, start, end) => {
    if (found) return;
    if (tag.name === "details" && !tag.closing) {
      detailsDepth += 1;
      return;
    }
    if (tag.name === "details" && tag.closing) {
      detailsDepth = Math.max(0, detailsDepth - 1);
      return;
    }
    if (tag.name !== "summary" || detailsDepth !== 0) return;
    if (!tag.closing && elementStart < 0) {
      if (tag.selfClosing) {
        found = { elementStart: start, elementEnd: end, innerStart: end, innerEnd: end };
        return;
      }
      elementStart = start;
      innerStart = end;
      return;
    }
    if (tag.closing && elementStart >= 0) {
      found = { elementStart, elementEnd: end, innerStart, innerEnd: start };
    }
  });
  return found;
}

function detailsRegions(tree: MdastNode): DetailsRegion[] {
  const opens: number[] = [];
  const regions: DetailsRegion[] = [];
  for (const node of htmlNodes(tree)) {
    const base = node.position?.start?.offset;
    if (typeof base !== "number" || typeof node.value !== "string") continue;
    scanHtmlTags(node.value, base, (tag, start, end) => {
      if (tag.name !== "details") return;
      if (tag.closing) {
        const open = opens.pop();
        // An extra or inner close is not a region, so those tags stay escaped text.
        if (open === undefined || opens.length > 0) return;
        regions.push({ start: open, end });
        return;
      }
      if (tag.selfClosing) {
        if (opens.length > 0) return;
        regions.push({ start, end });
        return;
      }
      opens.push(start);
    });
  }
  return regions;
}

function shiftOffsets(nodes: MdastNode[], offset: number) {
  if (offset === 0) return;
  const walk = (node: MdastNode) => {
    if (typeof node.position?.start?.offset === "number") {
      node.position.start.offset += offset;
    }
    if (typeof node.position?.end?.offset === "number") {
      node.position.end.offset += offset;
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
}

function parsedChildren(slice: string): MdastNode[] {
  const tree = markdownParser.parse(slice) as MdastNode;
  const children = tree.children ?? [];
  const regions = detailsRegions(tree);
  return regions.length > 0 ? promoteDetails(children, regions, slice) : children;
}

function parseBlocks(slice: string): MdastNode[] {
  if (slice.trim().length === 0) return [];
  return parsedChildren(slice);
}

function parseSummary(source: string, baseOffset: number): MdastNode[] {
  if (source.length === 0) return [];
  const leading = source.length - source.trimStart().length;
  const text = source.trim();
  if (text.length === 0) return [];
  let nodes = parsedChildren(text);
  if (nodes.length === 1 && nodes[0]?.type === "paragraph" && nodes[0].children) {
    nodes = nodes[0].children;
  }
  shiftOffsets(nodes, baseOffset + leading);
  return nodes;
}

/** Author attributes are dropped so the section stays closed and only renderer classes apply. */
function disclosureElement(summaryChildren: MdastNode[], bodyChildren: MdastNode[]): MdastNode {
  return {
    type: "details",
    data: { hName: "details" },
    children: [
      {
        type: "summary",
        data: { hName: "summary" },
        children: summaryChildren,
      },
      ...bodyChildren,
    ],
  };
}

function clearOffsets(nodes: MdastNode[]) {
  const walk = (node: MdastNode) => {
    delete node.position;
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
}

/**
 * One raw HTML block holds the whole section, so the body is parsed from that
 * block's text. Blockquote markers are already stripped from the text.
 */
function detailsFromHtmlBlock(node: MdastNode, source: string): MdastNode {
  const value = node.value ?? "";
  const base = node.position?.start?.offset ?? 0;
  const blockEnd = node.position?.end?.offset;
  const aligns = typeof blockEnd === "number" && source.slice(base, blockEnd) === value;
  let openTagEnd = 0;
  let closeStart = value.length;
  let depth = 0;
  let sawOpen = false;
  scanHtmlTags(value, 0, (tag, start, tagEnd) => {
    if (tag.name !== "details") return;
    if (!tag.closing) {
      if (!sawOpen) openTagEnd = tagEnd;
      sawOpen = true;
      depth += 1;
      return;
    }
    depth -= 1;
    if (depth === 0) closeStart = start;
  });
  const inner = value.slice(openTagEnd, closeStart);
  const summary = summaryInDetails(inner);
  const summaryText = summary ? inner.slice(summary.innerStart, summary.innerEnd) : "";
  const bodySlices: Array<{ start: number; end: number }> = [];
  if (!summary) {
    if (openTagEnd < closeStart) bodySlices.push({ start: openTagEnd, end: closeStart });
  } else {
    const elementStart = openTagEnd + summary.elementStart;
    const elementEnd = openTagEnd + summary.elementEnd;
    if (openTagEnd < elementStart) bodySlices.push({ start: openTagEnd, end: elementStart });
    if (elementEnd < closeStart) bodySlices.push({ start: elementEnd, end: closeStart });
  }
  const summaryChildren = parseSummary(summaryText, aligns ? base + openTagEnd + (summary?.innerStart ?? 0) : 0);
  const bodyChildren = bodySlices.flatMap((slice) => {
    const nodes = parseBlocks(value.slice(slice.start, slice.end));
    if (aligns) shiftOffsets(nodes, base + slice.start);
    return nodes;
  });
  // A blockquote strips `>` from the HTML text, so those positions are not the source range.
  if (!aligns) {
    clearOffsets(summaryChildren);
    clearOffsets(bodyChildren);
  }
  return disclosureElement(summaryChildren, bodyChildren);
}

function summaryFromPieces(pieces: Piece[]): MdastNode[] {
  if (pieces.length === 0) return [];
  if (pieces.every((piece) => piece.kind === "raw")) {
    return parseSummary(pieces.map((piece) => piece.text).join(""), 0);
  }
  const children: MdastNode[] = [];
  let raw = "";
  const flush = () => {
    if (raw.length === 0) return;
    const nodes = parseSummary(raw, 0);
    clearOffsets(nodes);
    children.push(...nodes);
    raw = "";
  };
  for (const piece of pieces) {
    if (piece.kind === "raw") {
      raw += piece.text;
      continue;
    }
    flush();
    children.push(piece.node);
  }
  flush();
  return children;
}

function bodyFromPieces(pieces: Piece[], source: string): MdastNode[] {
  const children: MdastNode[] = [];
  let raw = "";
  let originals: MdastNode[] = [];
  const flushOriginals = () => {
    if (originals.length === 0) return;
    const regions = detailsRegions({ type: "root", children: originals });
    children.push(...(regions.length > 0 ? promoteDetails(originals, regions, source) : originals));
    originals = [];
  };
  const flushRaw = () => {
    if (raw.length === 0) return;
    const nodes = parseBlocks(raw);
    clearOffsets(nodes);
    children.push(...nodes);
    raw = "";
  };
  for (const piece of pieces) {
    if (piece.kind === "raw") {
      flushOriginals();
      raw += piece.text;
      continue;
    }
    flushRaw();
    originals.push(piece.node);
  }
  flushRaw();
  flushOriginals();
  return children;
}

function isOuterClose(node: MdastNode | undefined): boolean {
  return node?.type === "html" && typeof node.value === "string" && /^<\/details\s*>$/i.test(node.value.trim());
}

/**
 * Parsed siblings inside the section stay as they are, so a blockquote or list
 * keeps the structure the outer parse already produced. Nested sections are
 * still html nodes here; a later pass promotes them.
 */
function detailsFromSiblings(run: MdastNode[]): { summary: Piece[]; body: Piece[] } {
  const summary: Piece[] = [];
  const body: Piece[] = [];
  const place: { phase: "before" | "summary" | "body" } = { phase: "before" };
  let depth = 0;
  const content = isOuterClose(run[run.length - 1]) ? run.slice(0, -1) : run;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    if (place.phase === "summary") {
      summary.push({ kind: "raw", text });
      return;
    }
    if (place.phase === "before" && text.trim().length === 0) return;
    body.push({ kind: "raw", text });
  };

  const onTag = (tag: HtmlTag, raw: string) => {
    if (tag.name === "details" && !tag.closing) {
      depth += 1;
      if (depth > 1) pushText(raw);
      return;
    }
    if (tag.name === "details" && tag.closing) {
      if (depth > 1) pushText(raw);
      depth = Math.max(0, depth - 1);
      return;
    }
    if (tag.name === "summary" && depth === 1 && place.phase === "before" && !tag.closing) {
      place.phase = "summary";
      return;
    }
    if (tag.name === "summary" && depth === 1 && place.phase === "summary" && tag.closing) {
      place.phase = "body";
      return;
    }
    pushText(raw);
  };

  const feedHtml = (value: string) => {
    let cursor = 0;
    scanHtmlTags(value, 0, (tag, start, end) => {
      if (start > cursor) pushText(value.slice(cursor, start));
      onTag(tag, value.slice(start, end));
      cursor = end;
    });
    if (cursor < value.length) pushText(value.slice(cursor));
  };

  for (const node of content) {
    if (place.phase !== "body" && node.type === "html" && typeof node.value === "string") {
      feedHtml(node.value);
      continue;
    }
    if (place.phase === "summary") summary.push({ kind: "node", node });
    else body.push({ kind: "node", node });
  }
  return { summary, body };
}

function assembleDetails(run: MdastNode[], source: string): MdastNode {
  const only = run[0];
  if (run.length === 1 && only?.type === "html" && typeof only.value === "string") {
    return detailsFromHtmlBlock(only, source);
  }
  const pieces = detailsFromSiblings(run);
  return disclosureElement(summaryFromPieces(pieces.summary), bodyFromPieces(pieces.body, source));
}

function nodeOffsets(node: MdastNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

function fullyInside(node: MdastNode, region: DetailsRegion): boolean {
  const offsets = nodeOffsets(node);
  if (!offsets) return false;
  return offsets.start >= region.start && offsets.end <= region.end;
}

function containsRegion(node: MdastNode, region: DetailsRegion): boolean {
  const offsets = nodeOffsets(node);
  if (!offsets || fullyInside(node, region)) return false;
  return offsets.start <= region.start && offsets.end >= region.end;
}

function outermostRegion(node: MdastNode, regions: DetailsRegion[]): DetailsRegion | null {
  let best: DetailsRegion | null = null;
  for (const region of regions) {
    if (!fullyInside(node, region)) continue;
    if (!best || region.start < best.start || (region.start === best.start && region.end > best.end)) {
      best = region;
    }
  }
  return best;
}

function isDetailsElement(node: MdastNode): boolean {
  return node.data?.hName === "details";
}

/** A paragraph cannot contain a disclosure; lift it out as a sibling block. */
function liftDetailsOutOfParagraph(paragraph: MdastNode, children: MdastNode[]): MdastNode[] {
  if (!children.some(isDetailsElement)) {
    paragraph.children = children;
    return [paragraph];
  }
  const blocks: MdastNode[] = [];
  let phrasing: MdastNode[] = [];
  const flush = () => {
    if (phrasing.length === 0) return;
    blocks.push({ type: "paragraph", children: phrasing });
    phrasing = [];
  };
  for (const child of children) {
    if (isDetailsElement(child)) {
      flush();
      blocks.push(child);
      continue;
    }
    phrasing.push(child);
  }
  flush();
  return blocks;
}

function promoteDetails(nodes: MdastNode[], regions: DetailsRegion[], source: string): MdastNode[] {
  if (regions.length === 0) return nodes;
  const out: MdastNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index] as MdastNode;
    const region = outermostRegion(node, regions);
    if (region) {
      const run: MdastNode[] = [node];
      let end = index + 1;
      while (end < nodes.length && fullyInside(nodes[end] as MdastNode, region)) {
        run.push(nodes[end] as MdastNode);
        end += 1;
      }
      out.push(assembleDetails(run, source));
      index = end;
      continue;
    }
    const contained = regions.filter((item) => containsRegion(node, item));
    if (contained.length > 0 && node.children) {
      const children = promoteDetails(node.children, contained, source);
      if (node.type === "paragraph") {
        out.push(...liftDetailsOutOfParagraph(node, children));
      } else {
        node.children = children;
        out.push(node);
      }
      index += 1;
      continue;
    }
    out.push(node);
    index += 1;
  }
  return out;
}

export function remarkDetailsSummary() {
  return (tree: MdastNode & { children: MdastNode[] }, file: { toString(): string }) => {
    const source = file.toString();
    const regions = detailsRegions(tree);
    if (regions.length === 0) return;
    tree.children = promoteDetails(tree.children, regions, source);
  };
}
