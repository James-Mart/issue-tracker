import { GitBranch } from "lucide-react";
import { CopyTextButton } from "@/features/issues/components/copy-text-button";
import { formatRelativeUpdatedAt } from "@/features/issues/lib/format-relative-updated-at";

const COPY_MARKDOWN_LABEL = "Copy Markdown";
const FORK_LABEL = "Fork conversation from here";

export function AssistantMetaRow({
  at,
  markdown,
  onFork,
}: {
  at: string;
  markdown: string;
  onFork: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2 px-1 font-mono text-[11px] text-muted-foreground">
      <time dateTime={at}>{formatRelativeUpdatedAt(at)}</time>
      <CopyTextButton
        text={markdown}
        label={COPY_MARKDOWN_LABEL}
        testId="assistant-meta-copy-markdown"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:h-3 [&_svg]:w-3"
      />
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
