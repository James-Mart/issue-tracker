import { z } from "zod";

const nonEmpty = z.string().min(1);

/** Attachment or workspace path. Shared by Project supporting docs and a standards snapshot. */
export const supportingDocRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attachment"), name: nonEmpty }),
  z.object({ type: z.literal("workspace"), path: nonEmpty }),
]);

export type SupportingDocRef = z.infer<typeof supportingDocRefSchema>;
