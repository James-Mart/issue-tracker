import { useRef } from "react";
import { pruneSupersededDiffContents } from "../lib/issue-change-file-contents";

/**
 * File-contents cache for one diff panel.
 * When `tipSha` changes, entries for every other SHA are dropped during render,
 * before descendants read the cache. An unchanged tip keeps its entries.
 */
export function useDiffContentsCache(tipSha: string): Map<string, Promise<string>> {
  const cache = useRef(new Map<string, Promise<string>>()).current;
  const tipRef = useRef(tipSha);
  if (tipRef.current !== tipSha) {
    tipRef.current = tipSha;
    pruneSupersededDiffContents(cache, tipSha);
  }
  return cache;
}
