import type { RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.js";
import { IssueError } from "../services/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});

/** Multipart `file` field; maps oversize to IssueError (400). */
export const uploadAttachment: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
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
