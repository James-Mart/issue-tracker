import { z } from "zod";

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

const reviewSubmissionIdentity = {
  id: nonEmpty,
  at: nonEmpty,
  summaryCommentId: nonEmpty.optional(),
  threadIds: z.array(nonEmpty).min(1),
  // Set when bring-in accepts the resume prompt. Absent means it was not accepted.
  coordinatorResumed: z.literal(true).optional(),
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
