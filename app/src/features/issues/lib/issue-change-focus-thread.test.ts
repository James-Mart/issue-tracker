// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  fileNameForAnchorPath,
  threadNodeInPanel,
} from "./issue-change-focus-thread";

describe("fileNameForAnchorPath", () => {
  it("matches the current name or a rename's previous name", () => {
    const files = [
      { name: "new-name.ts", prevName: "old-name.ts" },
      { name: "other.ts" },
    ];
    expect(fileNameForAnchorPath(files, "new-name.ts")).toBe("new-name.ts");
    expect(fileNameForAnchorPath(files, "old-name.ts")).toBe("new-name.ts");
    expect(fileNameForAnchorPath(files, "missing.ts")).toBeUndefined();
  });
});

describe("threadNodeInPanel", () => {
  it("returns the thread article scoped to the panel", () => {
    const panel = document.createElement("div");
    const article = document.createElement("article");
    article.setAttribute("data-thread-root", "current-root");
    panel.append(article);
    const other = document.createElement("article");
    other.setAttribute("data-thread-root", "current-root");
    document.body.append(panel, other);
    expect(threadNodeInPanel(panel, "current-root")).toBe(article);
    panel.remove();
    other.remove();
  });
});
