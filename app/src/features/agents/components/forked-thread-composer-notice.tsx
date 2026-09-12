const READ_ONLY_FORK_COPY =
  "Read-only fork — explores and answers; cannot change files, run commands, or update the tracker.";

export function ForkedThreadComposerNotice() {
  return (
    <p
      className="min-w-0 px-3 pb-2 pt-1 text-xs leading-snug text-muted-foreground"
      data-testid="forked-thread-composer-notice"
    >
      {READ_ONLY_FORK_COPY}
    </p>
  );
}
