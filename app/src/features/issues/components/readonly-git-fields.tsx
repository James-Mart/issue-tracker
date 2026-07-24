import { GitPullRequest } from "lucide-react";

export function CommitShaDisplay({ commitSha }: { commitSha?: string }) {
  if (!commitSha) return null;
  return <span className="font-mono text-[13px] tabular-nums">{commitSha}</span>;
}

export function BranchNameDisplay({ branchName }: { branchName?: string }) {
  if (!branchName) return null;
  return <span className="font-mono text-[13px]">{branchName}</span>;
}

export function PrUrlDisplay({ prUrl }: { prUrl?: string }) {
  if (!prUrl) return null;
  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
    >
      <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{prUrl}</span>
    </a>
  );
}
