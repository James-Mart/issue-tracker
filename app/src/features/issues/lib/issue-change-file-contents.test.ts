import { parsePatchFiles } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedFileContents,
  changeFileCacheKey,
  fileDiffLoadedFiles,
  loadFileDiffContents,
  reconstructOldFileContents,
} from "./issue-change-file-contents";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const CONTEXT_PATCH = [
  "diff --git a/names.txt b/names.txt",
  "index 1111111..2222222 100644",
  "--- a/names.txt",
  "+++ b/names.txt",
  "@@ -6,7 +6,7 @@ echo",
  " foxtrot",
  " golf",
  " hotel",
  "-india",
  "+INDIA",
  " juliet",
  " kilo",
  " lima",
].join("\n");

const NEW_NAMES = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "INDIA",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
].join("\n") + "\n";

const OLD_NAMES = NEW_NAMES.replace("INDIA", "india");

const RENAME_PURE_PATCH = [
  "diff --git a/old-name.ts b/new-name.ts",
  "similarity index 100%",
  "rename from old-name.ts",
  "rename to new-name.ts",
].join("\n");

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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reconstructOldFileContents", () => {
  it("rebuilds the pre-change file from the new file and a partial patch", () => {
    const file = firstFile(CONTEXT_PATCH);
    expect(file.hunks[0]?.collapsedBefore).toBe(5);
    expect(reconstructOldFileContents(file, NEW_NAMES)).toBe(OLD_NAMES);
  });

  it("rebuilds across two hunks with a collapsed gap", () => {
    const file = firstFile(TWO_HUNK_PATCH);
    expect(file.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
    expect(reconstructOldFileContents(file, NEW_LETTERS)).toBe(OLD_LETTERS);
  });
});

describe("fileDiffLoadedFiles", () => {
  it("returns both sides for a changed file", () => {
    const file = firstFile(CONTEXT_PATCH);
    expect(fileDiffLoadedFiles(file, NEW_NAMES)).toEqual({
      oldFile: { name: "names.txt", contents: OLD_NAMES },
      newFile: { name: "names.txt", contents: NEW_NAMES },
    });
  });

  it("returns oldFile null for a pure rename", () => {
    const file = firstFile(RENAME_PURE_PATCH);
    expect(file.type).toBe("rename-pure");
    expect(fileDiffLoadedFiles(file, "unchanged\n")).toEqual({
      oldFile: null,
      newFile: { name: "new-name.ts", contents: "unchanged\n" },
    });
  });
});

describe("cachedFileContents", () => {
  it("reuses a resolved fetch and drops a rejected one so retry can run", async () => {
    const cache = new Map<string, Promise<string>>();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await expect(
      cachedFileContents(cache, "k", load),
    ).rejects.toThrow("fail");
    expect(cache.has("k")).toBe(false);

    await expect(cachedFileContents(cache, "k", load)).resolves.toBe("ok");
    await expect(cachedFileContents(cache, "k", load)).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("loadFileDiffContents", () => {
  it("fetches the new file at the issue sha and reuses the cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ contents: NEW_NAMES }));
    vi.stubGlobal("fetch", fetchMock);

    const file = firstFile(CONTEXT_PATCH);
    const cache = new Map<string, Promise<string>>();
    const first = await loadFileDiffContents({
      issueId: "task-1",
      sha: SHA,
      fileDiff: file,
      cache,
    });
    const second = await loadFileDiffContents({
      issueId: "task-1",
      sha: SHA,
      fileDiff: file,
      cache,
    });

    expect(first.newFile.contents).toBe(NEW_NAMES);
    expect(first.oldFile?.contents).toBe(OLD_NAMES);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `/api/issues/task-1/change/file?path=names.txt&sha=${SHA}`,
    );
    expect(cache.has(changeFileCacheKey(SHA, "names.txt"))).toBe(true);
  });
});
