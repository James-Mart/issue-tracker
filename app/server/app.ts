import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { join } from "path";
import { distDir, hasBuiltClient, isProdEnv } from "./config.js";
import { errorHandler } from "./errors.js";
import { agentModelsRouter } from "./routes/agent-models.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { eventsRouter } from "./routes/events.js";
import { createIssuesRouter } from "./routes/issues.js";
import { projectsRouter } from "./routes/projects.js";
import {
  agentSessions,
  type AgentSessions,
} from "./services/agent-sessions.js";
import {
  attachMultiplexedWebSocket,
  getConnectionDiagnostics,
} from "./services/multiplexed-ws.js";

export { attachMultiplexedWebSocket };

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  const path = req.originalUrl.split("?")[0];
  let logged = false;

  const writeLog = (label: string) => {
    if (logged) return;
    logged = true;
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    console.log(`[${label}] ${req.method} ${path} ${durationMs.toFixed(1)}ms`);
  };

  res.on("finish", () => {
    writeLog(String(res.statusCode));
  });

  res.on("close", () => {
    if (!res.writableFinished) {
      writeLog("closed");
    }
  });

  next();
}

export function createApp(sessions: AgentSessions = agentSessions): Express {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);

  const serveStatic = isProdEnv && hasBuiltClient;
  if (serveStatic) {
    app.use(express.static(distDir));
  }

  app.use("/api/issues", createIssuesRouter(sessions));
  app.use("/api/projects", projectsRouter);
  app.use("/api/conversations", createConversationsRouter(sessions));
  app.use("/api/events", eventsRouter);
  app.use("/api/agent-models", agentModelsRouter);

  app.get("/api/diagnostics/connections", (_req, res) => {
    res.json(getConnectionDiagnostics());
  });

  if (serveStatic) {
    app.get("*", (_req, res) => {
      res.sendFile(join(distDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
