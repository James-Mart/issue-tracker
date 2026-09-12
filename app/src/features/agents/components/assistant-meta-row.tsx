import { GitBranch } from "lucide-react";
import { formatRelativeUpdatedAt } from "@/features/issues/lib/format-relative-updated-at";

const FORK_LABEL = "Fork conversation from here";

export function AssistantMetaRow({
  at,
  onFork,
}: {
  at: string;
  onFork: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2 px-1 font-mono text-[11px] text-muted-foreground">
      <time dateTime={at}>{formatRelativeUpdatedAt(at)}</time>
      <button
        type="button"
        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={FORK_LABEL}
        title={FORK_LABEL}
        onClick={onFork}
      >
        <GitBranch className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
