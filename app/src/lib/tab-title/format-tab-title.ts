const TAB_TITLE_PREFIX = "IT: ";
const TAB_TITLE_MAX_GRAPHEMES = 25;
const TAB_TITLE_ELLIPSIS = "\u2026";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function graphemeCount(value: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(value)) {
    count += 1;
  }
  return count;
}

const TAB_TITLE_PREFIX_GRAPHEMES = graphemeCount(TAB_TITLE_PREFIX);
const TAB_TITLE_ELLIPSIS_GRAPHEMES = graphemeCount(TAB_TITLE_ELLIPSIS);

function graphemeSegments(value: string): Intl.SegmentData[] {
  return [...graphemeSegmenter.segment(value)];
}

function sliceGraphemes(value: string, maxGraphemes: number): string {
  return graphemeSegments(value)
    .slice(0, maxGraphemes)
    .map((part) => part.segment)
    .join("");
}

export type FormatTabTitleInput = {
  name: string;
  suffix?: string;
};

export function formatTabTitle({ name, suffix }: FormatTabTitleInput): string {
  const suffixPart = suffix ? `\u00B7${suffix}` : "";
  const body = suffix ? `${name}${suffixPart}` : name;
  const full = TAB_TITLE_PREFIX + body;

  if (graphemeCount(full) <= TAB_TITLE_MAX_GRAPHEMES) {
    return full;
  }

  if (suffix) {
    const suffixCount = graphemeCount(suffixPart);
    const nameBudget =
      TAB_TITLE_MAX_GRAPHEMES -
      TAB_TITLE_PREFIX_GRAPHEMES -
      suffixCount -
      TAB_TITLE_ELLIPSIS_GRAPHEMES;
    if (nameBudget < 0) {
      throw new Error(
        "Tab title suffix does not fit within the 25-grapheme limit",
      );
    }
    const truncatedName = sliceGraphemes(name, nameBudget);
    return (
      TAB_TITLE_PREFIX +
      truncatedName +
      TAB_TITLE_ELLIPSIS +
      suffixPart
    );
  }

  const nameBudget =
    TAB_TITLE_MAX_GRAPHEMES -
    TAB_TITLE_PREFIX_GRAPHEMES -
    TAB_TITLE_ELLIPSIS_GRAPHEMES;
  const truncatedName = sliceGraphemes(name, nameBudget);
  return TAB_TITLE_PREFIX + truncatedName + TAB_TITLE_ELLIPSIS;
}
