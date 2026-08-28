export function CommitShaDisplay({ commitSha }: { commitSha?: string }) {
  if (!commitSha) return null;
  return <span className="font-mono text-[13px] tabular-nums">{commitSha}</span>;
}

export function BranchNameDisplay({ branchName }: { branchName?: string }) {
  if (!branchName) return null;
  return <span className="font-mono text-[13px]">{branchName}</span>;
}
