import type { ReactNode } from "react";
import { CHIP_UNSET } from "@server/fields";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { taskHeadCommit } from "@server/services/commit-sha";
import {
  storyGitMetaScalars,
  taskGitMetaScalars,
  type GitMetaScalar,
  type GitMetaScalarKey,
} from "../lib/git-meta-scalars";
import { CompactMetaItem } from "./compact-meta";
import { IssueStackedOnField } from "./issue-stacked-on-field";
import { BranchNameDisplay, CommitShaDisplay } from "./readonly-git-fields";

function Mono({ children }: { children: string }) {
  return <span className="font-mono text-[13px] tabular-nums">{children}</span>;
}

function storyScalarValue(
  key: GitMetaScalarKey,
  issue: Extract<IssueDetail, { kind: "story" }>,
  mergeBase?: string,
) {
  switch (key) {
    case "branchName":
      return <BranchNameDisplay branchName={issue.branchName} />;
    case "mergeBase":
      return <Mono>{mergeBase ?? CHIP_UNSET}</Mono>;
    case "stackedOn":
      return <IssueStackedOnField issue={issue} />;
    default:
      return null;
  }
}

function taskScalarValue(
  key: GitMetaScalarKey,
  issue: Extract<IssueDetail, { kind: "task" }>,
  parentBranchName?: string,
) {
  switch (key) {
    case "branchName":
      return <BranchNameDisplay branchName={parentBranchName} />;
    case "commitSha":
      return <CommitShaDisplay commitSha={taskHeadCommit(issue)} />;
    case "noDiff":
      return <span>yes</span>;
    default:
      return null;
  }
}

function storyScalarRows(
  scalars: GitMetaScalar[],
  issue: Extract<IssueDetail, { kind: "story" }>,
  mergeBase?: string,
) {
  return scalars.map(({ key, label }) => (
    <CompactMetaItem
      key={key}
      label={label}
      value={storyScalarValue(key, issue, mergeBase)}
    />
  ));
}

/** Story git/spec scalar rows (no outer card — parent owns the block). */
export function StoryGitMetaScalars({
  issue,
  mergeBase,
  beforeStackedOn,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  mergeBase?: string;
  /** Sits with Branch and Merge base. `stackedOn` is always the last scalar. */
  beforeStackedOn?: ReactNode;
}) {
  const scalars = storyGitMetaScalars(issue, mergeBase);
  return (
    <>
      {storyScalarRows(scalars.slice(0, -1), issue, mergeBase)}
      {beforeStackedOn}
      {storyScalarRows(scalars.slice(-1), issue, mergeBase)}
    </>
  );
}

/** Task git/spec scalar rows (no outer card — parent owns the block). */
export function TaskGitMetaScalars({
  issue,
  issues,
}: {
  issue: Extract<IssueDetail, { kind: "task" }>;
  issues: IssueRecord[];
}) {
  const parent = issues.find((i) => i.id === issue.partOf);
  const parentBranchName =
    parent?.kind === "story" ? parent.branchName : undefined;
  const scalars = taskGitMetaScalars(issue, parentBranchName);
  if (scalars.length === 0) return null;
  return (
    <>
      {scalars.map(({ key, label }) => (
        <CompactMetaItem
          key={key}
          label={label}
          value={taskScalarValue(key, issue, parentBranchName)}
        />
      ))}
    </>
  );
}
