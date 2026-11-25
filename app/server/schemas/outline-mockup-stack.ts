/** `GET` / `POST` / `DELETE /api/issues/:id/mockups`. */
export type OutlineMockupStackPhase = "live" | "stopped" | "failed";

/**
 * The outline's Storybook, as the Mockups tab reads it.
 * `authorRun` is the mockup author's last reported run, which decides whether
 * Start restores bundles or serves the tree the author left.
 * `directions` are the accepted live bundles.
 */
export type OutlineMockupStackStatus = {
  phase: OutlineMockupStackPhase;
  command?: string;
  outputTail?: string;
  canRestore: boolean;
  treeMatchesPack: boolean;
  sessionId?: string;
  authorRun: "running" | "failed" | "clean";
  directions: string[];
};
