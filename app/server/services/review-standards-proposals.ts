import { z } from "zod";
import { formatZodError } from "../schemas.js";
import type { StandardsAssessment } from "../schemas/review.js";
import { standardsProposalTextSchema } from "../schemas/review-state.js";
import { iterateMarkComplete, proposalAfterText } from "../review-standards-status.js";
import { IssueError } from "./errors.js";

type StandardsProposal = StandardsAssessment["proposals"][number];

type StandardsProposalText = z.infer<typeof standardsProposalTextSchema>;

type ProposalTextFields = Omit<StandardsProposalText, "id">;

function writtenProposal<T extends z.ZodType<ProposalTextFields>>(schema: T): T {
  return schema
    .refine((proposal) => proposal.before.length > 0 || proposal.after.length > 0, {
      message: "a proposal needs before or after text",
    })
    .refine((proposal) => !/[\r\n]/.test(proposal.rationale), {
      message: "rationale is one line",
    });
}

export const standardsSetFileSchema = z
  .object({
    proposals: z.array(writtenProposal(standardsProposalTextSchema)),
  })
  .strict();

const replySchema = z.string().min(1).optional();

const standardsIterateFileSchema = z
  .object({
    outcomes: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum(["revise", "push-back", "withdraw"]),
          proposal: writtenProposal(standardsProposalTextSchema.omit({ id: true })),
          reply: replySchema,
        })
        .strict(),
    ),
    added: z.array(
      writtenProposal(standardsProposalTextSchema.extend({ reply: replySchema }).strict()),
    ),
  })
  .strict();

type IterateOutcome = z.infer<typeof standardsIterateFileSchema>["outcomes"][number];

export function proposalThreadError(
  proposal: Pick<StandardsProposalText, "id" | "threadIds">,
  allowed: ReadonlySet<string>,
): string | undefined {
  const unknown = proposal.threadIds.find((id) => !allowed.has(id));
  if (unknown) {
    return `proposal "${proposal.id}" names thread "${unknown}" outside the submission`;
  }
  return undefined;
}

/** The proposal as its card reads: the human's edit stands in for `after`. */
function cardText(proposal: StandardsProposal): StandardsProposalText {
  return {
    id: proposal.id,
    section: proposal.section,
    before: proposal.before,
    after: proposalAfterText(proposal),
    rationale: proposal.rationale,
    threadIds: proposal.threadIds,
  };
}

function sameText(a: ProposalTextFields, b: ProposalTextFields): boolean {
  return (
    a.section === b.section &&
    a.before === b.before &&
    a.after === b.after &&
    a.rationale === b.rationale &&
    a.threadIds.length === b.threadIds.length &&
    a.threadIds.every((id, index) => id === b.threadIds[index])
  );
}

function iterateFeedback(proposal: StandardsProposal): string {
  if (!iterateMarkComplete(proposal)) {
    throw new Error(`proposal "${proposal.id}" is marked Iterate without feedback`);
  }
  return proposal.feedback!.trim();
}

export type IterateRequestProposal = StandardsProposalText & {
  decision: NonNullable<StandardsProposal["decision"]> | "withdrawn";
  feedback?: string;
};

/**
 * Every proposal of a submitted round, as an iterate pass sends it. Only
 * `iterate` proposals carry feedback; the rest are read-only context.
 */
export function iterateRequestProposals(
  proposals: readonly StandardsProposal[],
): IterateRequestProposal[] {
  return proposals.map((proposal) => {
    if (proposal.withdrawn) return { ...cardText(proposal), decision: "withdrawn" };
    if (!proposal.decision) {
      throw new Error(`proposal "${proposal.id}" has no decision`);
    }
    return {
      ...cardText(proposal),
      decision: proposal.decision,
      ...(proposal.decision === "iterate" ? { feedback: iterateFeedback(proposal) } : {}),
    };
  });
}

function applyOutcome(
  proposal: StandardsProposal,
  outcome: IterateOutcome,
  allowed: ReadonlySet<string>,
): StandardsProposal {
  const notes = {
    sentFeedback: iterateFeedback(proposal),
    ...(outcome.reply ? { reply: outcome.reply } : {}),
  };
  if (outcome.kind === "revise") {
    const revised = { id: proposal.id, ...outcome.proposal };
    const threadError = proposalThreadError(revised, allowed);
    if (threadError) throw new IssueError("validation", threadError);
    return { ...revised, ...notes };
  }
  if (!sameText(outcome.proposal, cardText(proposal))) {
    throw new IssueError(
      "validation",
      `the ${outcome.kind} outcome for proposal "${proposal.id}" changes its text`,
    );
  }
  const {
    decision: _decision,
    feedback: _feedback,
    sentFeedback: _sentFeedback,
    reply: _reply,
    ...kept
  } = proposal;
  return { ...kept, ...notes, ...(outcome.kind === "withdraw" ? { withdrawn: true } : {}) };
}

/**
 * The round's proposals after an iterate pass reports `{ outcomes, added }`.
 * Refuses a report that misses an iterated proposal, names any other one, or
 * changes a pushed-back or withdrawn proposal's text.
 */
export function mergeIterateReport(
  proposals: readonly StandardsProposal[],
  submissionThreadIds: readonly string[],
  raw: unknown,
): StandardsProposal[] {
  const parsed = standardsIterateFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IssueError("validation", formatZodError(parsed.error, "invalid iterate file"));
  }
  const { outcomes, added } = parsed.data;
  const iterated = new Set(
    proposals.filter((proposal) => proposal.decision === "iterate").map(({ id }) => id),
  );
  const outcomeById = new Map<string, IterateOutcome>();
  for (const outcome of outcomes) {
    if (!iterated.has(outcome.id)) {
      throw new IssueError(
        "validation",
        `outcome names proposal "${outcome.id}", which was not marked Iterate`,
      );
    }
    if (outcomeById.has(outcome.id)) {
      throw new IssueError("validation", `proposal "${outcome.id}" has more than one outcome`);
    }
    outcomeById.set(outcome.id, outcome);
  }
  const missing = [...iterated].find((id) => !outcomeById.has(id));
  if (missing) throw new IssueError("validation", `proposal "${missing}" has no outcome`);

  const allowed = new Set(submissionThreadIds);
  const ids = new Set(proposals.map(({ id }) => id));
  for (const item of added) {
    if (ids.has(item.id)) {
      throw new IssueError("validation", `added proposal id "${item.id}" is already used`);
    }
    ids.add(item.id);
    const threadError = proposalThreadError(item, allowed);
    if (threadError) throw new IssueError("validation", threadError);
  }
  return [
    ...proposals.map((proposal) => {
      const outcome = outcomeById.get(proposal.id);
      return outcome ? applyOutcome(proposal, outcome, allowed) : proposal;
    }),
    ...added.map(({ reply, ...text }) => ({ ...text, ...(reply ? { reply } : {}) })),
  ];
}
