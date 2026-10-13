import type { ConversationChannel, Issue, IssueKind } from "./schemas.js";

export const KIND_LABEL: Record<IssueKind, string> = {
  project: "Project",
  epic: "Epic",
  idea: "Idea",
  story: "Story",
  task: "Task",
  review: "Review",
};

/** Per-kind field/affordance flags. Prefer these over ad-hoc `in` / kind checks. */
export const KIND_CAPABILITIES = {
  project: {
    partOf: false,
    /** Detail/edit UI shows the partOf field (distinct from storing partOf). */
    detailPartOf: false,
    archived: false,
    assignee: false,
    attention: false,
    attachments: true,
    comments: true,
    // CLI `comment` and detail comments UI are narrower than comments storage
    // (project has comments storage, not comment).
    comment: false,
    worktree: false,
  },
  idea: {
    partOf: true,
    // Ideas keep partOf on disk (project parent) but omit it from detail/edit chrome.
    detailPartOf: false,
    archived: true,
    assignee: false,
    attention: false,
    attachments: true,
    comments: true,
    comment: true,
    worktree: false,
  },
  epic: {
    partOf: true,
    detailPartOf: true,
    archived: true,
    assignee: false,
    attention: true,
    attachments: true,
    comments: true,
    comment: true,
    worktree: false,
  },
  story: {
    partOf: true,
    detailPartOf: true,
    archived: true,
    assignee: false,
    attention: true,
    attachments: true,
    comments: true,
    comment: true,
    worktree: true,
  },
  task: {
    partOf: true,
    detailPartOf: true,
    archived: true,
    assignee: true,
    attention: true,
    attachments: true,
    comments: true,
    comment: true,
    worktree: false,
  },
  review: {
    partOf: true,
    detailPartOf: false,
    archived: true,
    assignee: false,
    attention: false,
    attachments: false,
    comments: true,
    comment: true,
    worktree: true,
  },
} as const satisfies Record<
  IssueKind,
  {
    partOf: boolean;
    detailPartOf: boolean;
    archived: boolean;
    assignee: boolean;
    attention: boolean;
    attachments: boolean;
    comments: boolean;
    comment: boolean;
    worktree: boolean;
  }
>;

/** Workflow channel an issue offers for anchored conversations, if any. */
export function channelForIssue(
  issue: Extract<Issue, { kind: "story" }>,
  parentKind: IssueKind,
): ConversationChannel | undefined;
export function channelForIssue(
  issue: Exclude<Issue, { kind: "story" }>,
): ConversationChannel | undefined;
export function channelForIssue(
  issue: Issue,
  parentKind?: IssueKind,
): ConversationChannel | undefined {
  switch (issue.kind) {
    case "idea":
      return "planning";
    case "epic":
      return "implementing";
    case "story":
      return parentKind === "project" ? "implementing" : undefined;
    default:
      return undefined;
  }
}

/**
 * Export channel beside the workflow channel. Unarchived Epic or
 * project-level Story only.
 */
export function offersExportChannel(
  issue: Issue,
  parentKind?: IssueKind,
): boolean {
  if (issue.kind === "epic") return issue.archived !== true;
  if (issue.kind === "story" && parentKind === "project") {
    return issue.archived !== true;
  }
  return false;
}

/** Review conversations (review taskers, question researchers) anchor to the review issue. */
export function offersReviewChannel(issue: Issue): boolean {
  return issue.kind === "review";
}

export type AttentionIssue = Extract<
  Issue,
  { kind: "epic" | "story" | "task" }
>;
export type ArchivableIssue = Extract<
  Issue,
  { kind: "epic" | "idea" | "story" | "task" | "review" }
>;
export type AssigneeIssue = Extract<Issue, { kind: "task" }>;

export type KindCapability = keyof (typeof KIND_CAPABILITIES)[IssueKind];

type KindWithCapability<C extends KindCapability> = {
  [K in IssueKind]: (typeof KIND_CAPABILITIES)[K][C] extends true ? K : never;
}[IssueKind];

export type WorktreeIssue = Extract<Issue, { kind: KindWithCapability<"worktree"> }>;

export function hasWorktree(issue: Issue): issue is WorktreeIssue {
  return KIND_CAPABILITIES[issue.kind].worktree;
}

/** Capabilities that refuse with a user-facing validation error. */
export type RefuseableCapability = "attachments" | "comments" | "worktree";

export function kindHas(kind: IssueKind, capability: KindCapability): boolean {
  return KIND_CAPABILITIES[kind][capability];
}

export function articleForKind(kind: IssueKind): "a" | "an" {
  return kind === "epic" || kind === "idea" ? "an" : "a";
}

function capabilitySubject(capability: RefuseableCapability): string {
  switch (capability) {
    case "attachments":
      return "attachments are";
    case "comments":
      return "comments are";
    case "worktree":
      return "worktrees are";
  }
}

export function kindCapabilityRefusal(
  kind: IssueKind,
  capability: RefuseableCapability,
): string {
  return `${capabilitySubject(capability)} not allowed on ${articleForKind(kind)} ${KIND_LABEL[kind]}`;
}

export function hasAttention(issue: Issue): issue is AttentionIssue {
  return KIND_CAPABILITIES[issue.kind].attention;
}

export function hasAssignee(issue: Issue): issue is AssigneeIssue {
  return KIND_CAPABILITIES[issue.kind].assignee;
}

export function hasArchived(issue: Issue): issue is ArchivableIssue {
  return KIND_CAPABILITIES[issue.kind].archived;
}

export function hasPartOf(
  issue: Issue,
): issue is Extract<Issue, { partOf: string }> {
  return KIND_CAPABILITIES[issue.kind].partOf;
}
