import { describe, expect, it } from "vitest";
import { snippetLinesFromContents } from "./comment-anchor-snippet";

const CONTENTS = Array.from(
  { length: 100 },
  (_, index) => `line ${index + 1}`,
).join("\n");

describe("snippetLinesFromContents", () => {
  it("windows context around a single anchored line", () => {
    const lines = snippetLinesFromContents(CONTENTS, { line: 94 });
    expect(lines.map((line) => line.line)).toEqual([91, 92, 93, 94, 95, 96, 97]);
    expect(lines.filter((line) => line.anchored).map((line) => line.line)).toEqual(
      [94],
    );
    expect(lines.find((line) => line.line === 94)?.text).toBe("line 94");
  });

  it("marks every line in an anchored range", () => {
    const lines = snippetLinesFromContents(CONTENTS, {
      line: 90,
      startLine: 88,
    });
    expect(lines[0]?.line).toBe(85);
    expect(lines.at(-1)?.line).toBe(93);
    expect(lines.filter((line) => line.anchored).map((line) => line.line)).toEqual(
      [88, 89, 90],
    );
  });

  it("clamps to the file bounds", () => {
    const lines = snippetLinesFromContents("alpha\nbravo\n", { line: 1 });
    expect(lines.map((line) => ({ line: line.line, text: line.text }))).toEqual([
      { line: 1, text: "alpha" },
      { line: 2, text: "bravo" },
    ]);
    expect(lines[0]?.anchored).toBe(true);
    expect(lines[1]?.anchored).toBe(false);
  });
});
