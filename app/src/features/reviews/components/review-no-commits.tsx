import { ShellState } from "@/app/shell-state";

export function ReviewNoCommits({ eyebrow }: { eyebrow: string }) {
  return (
    <div data-testid="review-empty-diff">
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={eyebrow}
        title="No commits on this Story yet."
        detail="When a Task records a commit, its changes appear here for review."
      />
    </div>
  );
}
