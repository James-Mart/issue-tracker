import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { join } from "path";
import { distDir, hasBuiltClient, isProdEnv } from "./config.js";
import { errorHandler } from "./errors.js";
import { eventsRouter } from "./routes/events.js";
import { issuesRouter } from "./routes/issues.js";
import { projectsRouter } from "./routes/projects.js";

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const status = res.statusCode;
    if (status >= 400) return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const path = req.originalUrl.split("?")[0];
    console.log(`[${status}] ${req.method} ${path} ${durationMs.toFixed(1)}ms`);
  });
  next();
}

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);

  const serveStatic = isProdEnv && hasBuiltClient;
  if (serveStatic) {
    app.use(express.static(distDir));
  }

  app.use("/api/issues", issuesRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/events", eventsRouter);

  if (serveStatic) {
    app.get("*", (_req, res) => {
      res.sendFile(join(distDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
