// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { changeFileCacheKey } from "../lib/issue-change-file-contents";
import { useDiffContentsCache } from "./use-diff-contents-cache";

const TIP_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TIP_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

let root: Root | undefined;

function Probe({
  tip,
  cacheRef,
}: {
  tip: string;
  cacheRef: { current: Map<string, Promise<string>> | null };
}) {
  cacheRef.current = useDiffContentsCache(tip);
  return null;
}

function mount(tip: string, cacheRef: { current: Map<string, Promise<string>> | null }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Probe tip={tip} cacheRef={cacheRef} />);
  });
}

function rerender(tip: string, cacheRef: { current: Map<string, Promise<string>> | null }) {
  act(() => {
    root!.render(<Probe tip={tip} cacheRef={cacheRef} />);
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("useDiffContentsCache", () => {
  it("drops other SHAs when the tip changes and keeps the current tip", () => {
    const cacheRef: { current: Map<string, Promise<string>> | null } = { current: null };
    mount(TIP_A, cacheRef);
    const cache = cacheRef.current!;
    cache.set(changeFileCacheKey(TIP_A, "kept.ts"), Promise.resolve("kept"));
    cache.set(changeFileCacheKey(TIP_B, "soon.ts"), Promise.resolve("soon"));

    rerender(TIP_A, cacheRef);
    expect([...cache.keys()].sort()).toEqual(
      [changeFileCacheKey(TIP_A, "kept.ts"), changeFileCacheKey(TIP_B, "soon.ts")].sort(),
    );

    rerender(TIP_B, cacheRef);
    expect([...cache.keys()]).toEqual([changeFileCacheKey(TIP_B, "soon.ts")]);
    expect(cacheRef.current).toBe(cache);
  });
});
