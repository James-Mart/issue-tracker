import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { reconstructOldFileContents } from "./issue-change-file-contents";

const TWO_HUNK_PATCH = [
  "diff --git a/letters.txt b/letters.txt",
  "index 1111111..2222222 100644",
  "--- a/letters.txt",
  "+++ b/letters.txt",
  "@@ -1,6 +1,6 @@",
  " a",
  " b",
  "-c",
  "+C",
  " d",
  " e",
  " f",
  "@@ -12,7 +12,7 @@",
  " l",
  " m",
  " n",
  "-o",
  "+O",
  " p",
  " q",
  " r",
].join("\n");

const NEW_LETTERS = "a\nb\nC\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\nO\np\nq\nr\ns\nt\n";
const OLD_LETTERS = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\n";

function firstFile(patch: string) {
  const file = parsePatchFiles(patch).flatMap((parsed) => parsed.files)[0];
  if (file == null) throw new Error("expected a parsed file");
  return file;
}

describe("reconstructOldFileContents", () => {
  it("rebuilds across two hunks with a collapsed gap", () => {
    const file = firstFile(TWO_HUNK_PATCH);
    expect(file.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
    expect(reconstructOldFileContents(file, NEW_LETTERS)).toBe(OLD_LETTERS);
  });
});
