import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { formatZodError } from "../schemas.js";
import { IssueError } from "../services/errors.js";
import { humanDone } from "../services/human-handoff.js";

const humanDoneBodySchema = z.object({
  note: z.string().optional(),
});

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createStoriesRouter(): Router {
  const router = Router();

  router.post(
    "/:id/human-done",
    asyncRoute(async (req, res) => {
      const parsed = humanDoneBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new IssueError(
          "validation",
          formatZodError(parsed.error, "invalid human-done body"),
        );
      }
      const message = await humanDone(req.params.id, parsed.data.note);
      res.status(201).json(message);
    }),
  );

  return router;
}

export const storiesRouter = createStoriesRouter();
