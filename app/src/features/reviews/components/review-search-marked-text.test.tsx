import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkedPathText } from "./review-search-marked-text";

function marks(html: string, testId: string): string[] {
  return [...html.matchAll(new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`, "g"))].map(
    (found) => found[1]!,
  );
}

describe("MarkedPathText", () => {
  it("marks the current hit and dims the path's other hits", () => {
    const html = renderToStaticMarkup(
      <MarkedPathText text="src/Needle/needle.ts" needle="needle" occurrence={1} />,
    );

    expect(marks(html, "review-search-current")).toEqual(["needle"]);
    expect(marks(html, "review-search-match")).toEqual(["Needle"]);
    expect(html.replace(/<[^>]+>/g, "")).toBe("src/Needle/needle.ts");
  });

  it("dims every hit in a path that does not hold the current one", () => {
    const html = renderToStaticMarkup(
      <MarkedPathText text="needle/needle.ts" needle="needle" occurrence={undefined} />,
    );

    expect(marks(html, "review-search-current")).toEqual([]);
    expect(marks(html, "review-search-match")).toEqual(["needle", "needle"]);
  });

  it("renders plain text without a search", () => {
    expect(
      renderToStaticMarkup(<MarkedPathText text="src/a.ts" needle="" occurrence={undefined} />),
    ).toBe("src/a.ts");
  });
});
