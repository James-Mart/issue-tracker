import type { RequestHandler } from "express";
import express from "express";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.js";
import { IssueError } from "../services/errors.js";

const parseMarkdown = express.text({
  type: ["text/plain", "text/markdown"],
  limit: MAX_ATTACHMENT_BYTES,
});

/** Raw markdown body for reserved-draft overwrite. */
export const exportDraftMarkdown: RequestHandler = (req, res, next) => {
  parseMarkdown(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    const status = (err as { status?: number }).status;
    const type = (err as { type?: string }).type;
    if (status === 413 || type === "entity.too.large") {
      next(
        new IssueError(
          "validation",
          `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
        ),
      );
      return;
    }
    next(err);
  });
};
