import { useCallback, useState } from "react";
import type { FileDiffContentsLoader } from "@pierre/diffs/react";
import { loadFileDiffContents } from "../lib/issue-change-file-contents";

/** Pierre `loadDiffFiles` for context expansion, with a flag while file contents load. */
export function useFileDiffContentsLoader({
  issueId,
  sha,
  cache,
}: {
  issueId: string;
  sha: string;
  cache: Map<string, Promise<string>>;
}): { loading: boolean; loadDiffFiles: FileDiffContentsLoader } {
  const [loading, setLoading] = useState(false);
  const loadDiffFiles: FileDiffContentsLoader = useCallback(
    async (fileDiff) => {
      setLoading(true);
      try {
        return await loadFileDiffContents({ issueId, sha, fileDiff, cache });
      } finally {
        setLoading(false);
      }
    },
    [cache, issueId, sha],
  );
  return { loading, loadDiffFiles };
}
