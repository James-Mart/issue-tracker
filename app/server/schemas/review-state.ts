import { z } from "zod";
import { supportingDocRefSchema } from "./supporting-doc.js";

const nonEmpty = z.string().min(1);

const allMarkSchema = z
  .object({
    // Empty when the post-image has no blob (a deletion).
    blobSha: z.string(),
    markedAt: nonEmpty,
  })
  .strict();

const commitMarkSchema = z
  .object({
    markedAt: nonEmpty,
  })
  .strict();

export const reviewMarksSchema = z
  .object({
    all: z.record(z.string(), allMarkSchema),
    commits: z.record(z.string(), z.record(z.string(), commitMarkSchema)),
  })
  .strict();

export type ReviewMarks = z.infer<typeof reviewMarksSchema>;

/**
 * GitHub pull request a review was loaded from. `baseRef` and `headRef` are
 * branch names. `state` is the last GitHub state followed; it stays absent
 * while that state is open.
 */
export const reviewPrSourceSchema = z
  .object({
    url: nonEmpty,
    number: z.number().int().positive(),
    baseRef: nonEmpty,
    headRef: nonEmpty,
    headSha: nonEmpty,
    fork: z.boolean(),
    state: z.enum(["open", "closed", "merged"]).optional(),
  })
  .strict();

export type ReviewPrSource = z.infer<typeof reviewPrSourceSchema>;

/** A proposal as the assessor writes it. */
export const standardsProposalTextSchema = z
  .object({
    id: nonEmpty,
    section: nonEmpty,
    before: z.string(),
    after: z.string(),
    rationale: nonEmpty,
    threadIds: z.array(nonEmpty).min(1),
  })
  .strict();

export const standardsProposalSchema = standardsProposalTextSchema
  .extend({
    decision: z.enum(["accepted", "rejected", "iterate"]).optional(),
    editedAfter: z.string().optional(),
    // Iterate draft. It stays while another decision is chosen.
    feedback: nonEmpty.optional(),
    // Feedback sent with this proposal's latest iterate pass.
    sentFeedback: nonEmpty.optional(),
    // The assessor's reply on this proposal's latest iterate pass.
    reply: nonEmpty.optional(),
    // Withdrawn by the assessor: shown, never decided or applied.
    withdrawn: z.literal(true).optional(),
  })
  .strict();

export const standardsAssessmentSchema = z
  .object({
    status: z.enum([
      "assessing",
      "assessFailed",
      "ready",
      "noGaps",
      // Iterate marks sent back to the assessor; a failed pass returns to `ready` with `error`.
      "iterating",
      "applying",
      "applyFailed",
      "applied",
    ]),
    conversationId: nonEmpty.optional(),
    doc: supportingDocRefSchema,
    proposals: z.array(standardsProposalSchema),
    error: nonEmpty.optional(),
  })
  .strict();

export type StandardsAssessment = z.infer<typeof standardsAssessmentSchema>;

const reviewSubmissionIdentity = {
  id: nonEmpty,
  at: nonEmpty,
  summaryCommentId: nonEmpty.optional(),
  threadIds: z.array(nonEmpty).min(1),
  // Set when bring-in accepts the resume prompt. Absent means it was not accepted.
  coordinatorResumed: z.literal(true).optional(),
  standards: standardsAssessmentSchema.optional(),
};

export const reviewSubmissionSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...reviewSubmissionIdentity,
      // Filled once the background launch has created the tasker conversation.
      conversationId: nonEmpty.optional(),
      status: z.literal("tasking"),
      taskIds: z.array(nonEmpty).optional(),
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("incomplete"),
      taskIds: z.array(nonEmpty).optional(),
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("failed"),
      taskIds: z.array(nonEmpty).optional(),
      error: nonEmpty,
    })
    .strict(),
  z
    .object({
      ...reviewSubmissionIdentity,
      conversationId: nonEmpty.optional(),
      status: z.literal("done"),
      taskIds: z.array(nonEmpty),
      // Set when the threads went to a new Idea instead of Tasks on the Story.
      ideaId: nonEmpty.optional(),
    })
    .strict(),
]);

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;
