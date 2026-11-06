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
import type { IssueSupplement } from "../hooks/use-supplemented-by-id";
import { CompactMetaItem } from "./compact-meta";
import { IssueStackedOnField } from "./issue-stacked-on-field";
import { BranchNameDisplay, CommitShaDisplay } from "./readonly-git-fields";

function stackedOnMetaRow(
  issue: Extract<IssueDetail, { kind: "story" }>,
  tail: GitMetaScalar | undefined,
  supplement?: IssueSupplement,
) {
  if (!tail || tail.key !== "stackedOn") return null;
  return (
    <CompactMetaItem
      key={tail.key}
      label={tail.label}
      value={<IssueStackedOnField issue={issue} supplement={supplement} />}
    />
  );
}

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

export function storyGitScalarRows(
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

/** Branch + optional merge-base rows (all git scalars except stacked on). */
export function StoryGitHeadScalarRows({
  issue,
  mergeBase,
  /** When the parent already computed `storyGitMetaScalars`, pass it to avoid duplicate work. */
  scalars: scalarsProp,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  mergeBase?: string;
  scalars?: GitMetaScalar[];
}) {
  const scalars = scalarsProp ?? storyGitMetaScalars(issue, mergeBase);
  const head = scalars.slice(0, -1);
  return <>{storyGitScalarRows(head, issue, mergeBase)}</>;
}

/** Stacked-on row only (last story git scalar). */
export function StoryGitStackedOnRow({
  issue,
  mergeBase,
  scalars: scalarsProp,
  supplement,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  mergeBase?: string;
  scalars?: GitMetaScalar[];
  supplement?: IssueSupplement;
}) {
  const scalars = scalarsProp ?? storyGitMetaScalars(issue, mergeBase);
  const tail = scalars.at(-1);
  return stackedOnMetaRow(issue, tail, supplement);
}

/** Story git/spec scalar rows (no outer card — parent owns the block). */
export function StoryGitMetaScalars({
  issue,
  mergeBase,
  scalars: scalarsProp,
  mergeSettings,
  beforeStackedOn,
  supplement,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  mergeBase?: string;
  /** When the caller already computed `storyGitMetaScalars`, pass it to avoid rebuilding. */
  scalars?: GitMetaScalar[];
  /** Merge-base and merge-policy rows. Sits after the other git scalars, before stacked on. */
  mergeSettings?: ReactNode;
  /** Sits with Branch and Merge base. `stackedOn` is always the last scalar. */
  beforeStackedOn?: ReactNode;
  supplement?: IssueSupplement;
}) {
  const scalars = scalarsProp ?? storyGitMetaScalars(issue, mergeBase);
  const head = scalars.slice(0, -1);
  const tail = scalars.at(-1);
  return (
    <>
      {storyGitScalarRows(head, issue, mergeBase)}
      {mergeSettings}
      {beforeStackedOn}
      {stackedOnMetaRow(issue, tail, supplement)}
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
