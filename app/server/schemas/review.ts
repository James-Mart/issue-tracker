import { z } from "zod";
import { formatZodError } from "./issue.js";

const nonEmpty = z.string().min(1);

const allMarkSchema = z
  .object({
    blobSha: nonEmpty,
    markedAt: nonEmpty,
  })
  .strict();

const commitMarkSchema = z
  .object({
    markedAt: nonEmpty,
  })
  .strict();

export const reviewTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("story"),
      storyId: nonEmpty,
    })
    .strict(),
]);

export const reviewSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    target: reviewTargetSchema,
    status: z.enum(["open", "archived"]),
    postMortem: z.boolean(),
    createdAt: nonEmpty,
    updatedAt: nonEmpty,
    marks: z
      .object({
        all: z.record(z.string(), allMarkSchema),
        commits: z.record(
          z.string(),
          z.record(z.string(), commitMarkSchema),
        ),
      })
      .strict(),
  })
  .strict();

export type Review = z.infer<typeof reviewSchema>;

export type ReviewView =
  | (Review & { effectiveStatus: "open" })
  | (Review & {
      effectiveStatus: "archived";
      archivedReason: "explicit" | "merged";
    });

export const openReviewBodySchema = z
  .object({
    target: reviewTargetSchema,
  })
  .strict();

export type OpenReviewBody = z.infer<typeof openReviewBodySchema>;

export type OpenReviewBodyParseResult =
  | { ok: true; body: OpenReviewBody }
  | { ok: false; message: string };

export function parseOpenReviewBody(raw: unknown): OpenReviewBodyParseResult {
  const result = openReviewBodySchema.safeParse(raw);
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid review body"),
  };
}

export type ReviewParseResult =
  | { ok: true; review: Review }
  | { ok: false; message: string };

export function parseReviewRecord(raw: unknown): ReviewParseResult {
  const result = reviewSchema.safeParse(raw);
  if (result.success) return { ok: true, review: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid review"),
  };
}
