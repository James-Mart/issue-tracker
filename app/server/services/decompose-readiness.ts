/** A linked root as Ready to decompose reads it. */
export type DecomposeRoot = {
  version: number;
  /** Not yet complete: story not merged, epic status not done. */
  open: boolean;
  archived: boolean;
};

export type DecomposeOutline = {
  concludedAt?: string;
  outOfBand?: boolean;
  bodyVersion: number;
};

/** The stamp, completeness, and archive flag Ready to decompose reads. */
export function decomposeRootOf(root: {
  version: number;
  open: boolean;
  archived: boolean;
}): DecomposeRoot {
  return {
    version: root.version,
    open: root.open,
    archived: root.archived,
  };
}

function rootIsClosed(root: DecomposeRoot): boolean {
  return root.archived || !root.open;
}

/**
 * From version for decomposing again: the newest stamp among linked roots
 * when every one is merged or archived and the outline body is newer than
 * each stamp. Absent for a first decompose, and when a root is still open
 * or already stamped at the latest body.
 */
export function redecomposeFrom(
  bodyVersion: number,
  roots: readonly DecomposeRoot[],
): number | undefined {
  if (roots.length === 0 || !roots.every(rootIsClosed)) return undefined;
  const newest = Math.max(...roots.map((root) => root.version));
  if (newest >= bodyVersion) return undefined;
  return newest;
}

/**
 * Structural half of Ready to decompose, plus the From version when the
 * closed-roots case is why it is ready. A live decomposition run is cleared
 * later by `list()`.
 */
export function outlineDecomposeStart(
  outline: DecomposeOutline,
  linkedRoots: readonly DecomposeRoot[],
): { ready: boolean; from?: number } {
  if (!outline.concludedAt || outline.outOfBand === true) return { ready: false };
  if (linkedRoots.length === 0) return { ready: true };
  const from = redecomposeFrom(outline.bodyVersion, linkedRoots);
  if (from === undefined) return { ready: false };
  return { ready: true, from };
}

/** Structural half of Ready to decompose. See `outlineDecomposeStart`. */
export function outlineReadyToDecompose(
  outline: DecomposeOutline,
  linkedRoots: readonly DecomposeRoot[],
): boolean {
  return outlineDecomposeStart(outline, linkedRoots).ready;
}
