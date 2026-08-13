import { CHIP_UNSET } from "@server/fields";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { QA_STATUS_LABEL, REVIEW_LABEL } from "../lib/derived";
import {
  storyGitMetaScalars,
  taskGitMetaScalars,
  type GitMetaScalarKey,
} from "../lib/git-meta-scalars";
import { CompactMetaItem } from "./compact-meta";
import { IssueMergedField } from "./issue-merged-field";
import { IssueStackedOnField } from "./issue-stacked-on-field";
import {
  BranchNameDisplay,
  CommitShaDisplay,
  PrUrlDisplay,
} from "./readonly-git-fields";

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
    case "prUrl":
      return <PrUrlDisplay prUrl={issue.prUrl} />;
    case "merged":
      return <IssueMergedField issue={issue} />;
    case "review":
      return issue.review ? (
        <span>{REVIEW_LABEL[issue.review]}</span>
      ) : null;
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
      return <CommitShaDisplay commitSha={issue.commitSha} />;
    case "noDiff":
      return <span>yes</span>;
    case "qa":
      return issue.qa ? <span>{QA_STATUS_LABEL[issue.qa]}</span> : null;
    default:
      return null;
  }
}

/** Story git/spec scalar rows (no outer card — parent owns the block). */
export function StoryGitMetaScalars({
  issue,
  mergeBase,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  mergeBase?: string;
}) {
  const scalars = storyGitMetaScalars(issue, mergeBase);
  if (scalars.length === 0) return null;
  return (
    <>
      {scalars.map(({ key, label }) => (
        <CompactMetaItem
          key={key}
          label={label}
          value={storyScalarValue(key, issue, mergeBase)}
        />
      ))}
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
