import { Router, type Response } from "express";
import chokidar, { type FSWatcher } from "chokidar";
import { basename, relative, sep } from "path";
import { issuesDir } from "../config.js";
import type {
  IssueEvent,
  IssueEventScope,
  IssueEventType,
} from "../schemas.js";

const HEARTBEAT_MS = 10_000;

const clients = new Set<Response>();
let watcher: FSWatcher | null = null;

function send(res: Response, payload: string): boolean {
  if (res.writableEnded) {
    clients.delete(res);
    return false;
  }
  try {
    res.write(payload);
    return true;
  } catch (err) {
    clients.delete(res);
    console.error("dropping unwritable SSE client:", err);
    return false;
  }
}

export function issueIdFromPath(baseDir: string, filePath: string): string | null {
  const rel = relative(baseDir, filePath);
  if (!rel || rel.startsWith("..")) return null;
  const [id] = rel.split(sep);
  return id || null;
}

export function scopeFromPath(filePath: string): IssueEventScope {
  if (basename(filePath) === "chat.jsonl") return "chat";
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.endsWith("/attachments") ||
    normalized.includes("/attachments/")
  ) {
    return "attachments";
  }
  return "issue";
}

function broadcast(event: IssueEvent): void {
  const payload = `event: issue\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) send(res, payload);
}

function emit(type: IssueEventType, filePath: string): void {
  const id = issueIdFromPath(issuesDir, filePath);
  if (id) broadcast({ type, id, scope: scopeFromPath(filePath) });
}

function startWatcher(): void {
  if (watcher) return;
  watcher = chokidar.watch(issuesDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });
  watcher
    .on("add", (path) => emit("add", path))
    .on("change", (path) => emit("change", path))
    .on("unlink", (path) => emit("unlink", path))
    .on("unlinkDir", (path) => emit("unlink-dir", path))
    .on("error", (err) => console.error("issues watcher error:", err));
}

export const eventsRouter = Router();

const HEARTBEAT_PAYLOAD = "event: ping\ndata: {}\n\n";

eventsRouter.get("/", (req, res) => {
  startWatcher();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  clients.add(res);
  send(res, HEARTBEAT_PAYLOAD);
  const heartbeat = setInterval(() => send(res, HEARTBEAT_PAYLOAD), HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    res.end();
  });
});
