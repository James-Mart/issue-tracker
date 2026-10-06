import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { isFullCommitSha } from "./commit-sha.js";
import { IssueError } from "./errors.js";
import { runGit, spawnReadOnlyGit } from "./git-read.js";

const EMPTY = Buffer.alloc(0);
const CAT_FILE_HEADER = /^[0-9a-fA-F]+ (\S+) (\d+)$/;

type BatchObject =
  | { missing: false; type: string; contents: string }
  | { missing: true };

type BlobLoad =
  | { kind: "blob"; contents: string | null }
  | { kind: "defer" };

type Waiter = {
  resolve: (object: BatchObject) => void;
  reject: (error: unknown) => void;
};

type Session = {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  buffer: Buffer;
  waiters: Waiter[];
  stderr: string;
  closed: boolean;
};

type RepoEntry = {
  workspace: string;
  /** Resolved blob bytes, or null when the path is absent at that commit. */
  cache: Map<string, string | null>;
  inflight: Map<string, Promise<string | null>>;
  session: Session | null;
};

const repos = new Map<string, RepoEntry>();

const LIVE_CHILDREN = Symbol.for("issue-tracker.gitCatFileChildren");

/**
 * One exit hook for every copy of this module loaded in the process. A second
 * copy must not register another listener.
 */
function liveChildren(): Set<ChildProcess> {
  const host = globalThis as typeof globalThis & {
    [LIVE_CHILDREN]?: Set<ChildProcess>;
  };
  const existing = host[LIVE_CHILDREN];
  if (existing) return existing;
  const children = new Set<ChildProcess>();
  host[LIVE_CHILDREN] = children;
  process.on("exit", () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });
  return children;
}

function trackChild(child: ChildProcess): void {
  const children = liveChildren();
  children.add(child);
  child.once("close", () => {
    children.delete(child);
  });
}

type RefStream = ChildProcess | Readable | Writable;

function setStreamRef(stream: RefStream, active: boolean): void {
  const candidate = stream as { ref?: () => void; unref?: () => void };
  const fn = active ? candidate.ref : candidate.unref;
  if (typeof fn === "function") fn.call(stream);
}

/** An idle cat-file must not keep the process alive after the request that used it. */
function holdSession(session: Session, active: boolean): void {
  setStreamRef(session.child, active);
  setStreamRef(session.child.stdin, active);
  setStreamRef(session.child.stdout, active);
  setStreamRef(session.child.stderr, active);
}

function noteWaiters(session: Session): void {
  holdSession(session, session.waiters.length > 0);
}

function failSession(entry: RepoEntry, error: IssueError): void {
  const session = entry.session;
  if (!session || session.closed) return;
  session.closed = true;
  entry.session = null;
  const waiters = session.waiters.splice(0);
  noteWaiters(session);
  for (const waiter of waiters) waiter.reject(error);
  if (session.child.exitCode === null && session.child.signalCode === null) {
    session.child.kill();
  }
}

function endEntry(entry: RepoEntry): void {
  failSession(entry, new IssueError("git-failed", "git cat-file closed"));
}

function nameBreaksBatchLine(name: string): boolean {
  return name.includes("\n") || name.includes("\0");
}

function isCommitUnreachableMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("bad object") ||
    lower.includes("unknown revision") ||
    lower.includes("invalid object name")
  );
}

function isPathMissingAtCommitMessage(message: string): boolean {
  return message.toLowerCase().includes("does not exist in");
}

function takeOne(
  buffer: Buffer,
): { object: BatchObject; rest: Buffer } | null {
  const nl = buffer.indexOf(0x0a);
  if (nl < 0) return null;
  const header = buffer.toString("utf8", 0, nl);
  if (header.endsWith(" missing")) {
    return { object: { missing: true }, rest: copyRest(buffer, nl + 1) };
  }
  const match = CAT_FILE_HEADER.exec(header);
  if (!match) {
    throw new IssueError(
      "git-failed",
      `git cat-file returned ${JSON.stringify(header)}`,
    );
  }
  const size = Number(match[2]);
  const start = nl + 1;
  const end = start + size;
  if (buffer.length < end + 1) return null;
  if (buffer[end] !== 0x0a) {
    throw new IssueError(
      "git-failed",
      "git cat-file payload was not newline-terminated",
    );
  }
  return {
    object: {
      missing: false,
      type: match[1]!,
      contents: buffer.toString("utf8", start, end),
    },
    rest: copyRest(buffer, end + 1),
  };
}

function copyRest(buffer: Buffer, from: number): Buffer {
  if (from >= buffer.length) return EMPTY;
  return Buffer.from(buffer.subarray(from));
}

function drain(session: Session): void {
  for (;;) {
    const taken = takeOne(session.buffer);
    if (!taken) return;
    session.buffer = taken.rest;
    const waiter = session.waiters.shift();
    noteWaiters(session);
    if (!waiter) {
      throw new IssueError(
        "git-failed",
        "git cat-file responded with no request waiting",
      );
    }
    waiter.resolve(taken.object);
  }
}

function startSession(entry: RepoEntry): Session {
  const child = spawnReadOnlyGit(["cat-file", "--batch"], entry.workspace);
  const session: Session = {
    child,
    buffer: EMPTY,
    waiters: [],
    stderr: "",
    closed: false,
  };
  entry.session = session;
  trackChild(child);
  holdSession(session, false);

  child.stdout.on("data", (chunk: Buffer | string) => {
    if (session.closed) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    session.buffer =
      session.buffer.length === 0 ? bytes : Buffer.concat([session.buffer, bytes]);
    try {
      drain(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failSession(
        entry,
        err instanceof IssueError ? err : new IssueError("git-failed", message),
      );
    }
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    session.stderr += chunk;
  });

  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      failSession(entry, new IssueError("git-missing", "git binary not found"));
      return;
    }
    failSession(entry, new IssueError("git-failed", err.message));
  });

  child.on("close", (code) => {
    const message =
      session.stderr.trim() || `git exited with code ${code ?? "null"}`;
    failSession(entry, new IssueError("git-failed", message));
  });

  return session;
}

function ensureSession(entry: RepoEntry): Session {
  if (entry.session && !entry.session.closed) return entry.session;
  return startSession(entry);
}

function query(entry: RepoEntry, objectName: string): Promise<BatchObject> {
  const session = ensureSession(entry);
  return new Promise((resolve, reject) => {
    session.waiters.push({ resolve, reject });
    noteWaiters(session);
    const stdin = session.child.stdin;
    if (!stdin) {
      failSession(
        entry,
        new IssueError("git-failed", "git cat-file stdin is closed"),
      );
      return;
    }
    stdin.write(`${objectName}\n`, "utf8", (err) => {
      if (err && !session.closed) {
        failSession(entry, new IssueError("git-failed", err.message));
      }
    });
  });
}

function repoEntry(workspace: string): RepoEntry {
  const existing = repos.get(workspace);
  if (existing) return existing;
  const created: RepoEntry = {
    workspace,
    cache: new Map(),
    inflight: new Map(),
    session: null,
  };
  repos.set(workspace, created);
  return created;
}

async function loadBlob(
  entry: RepoEntry,
  sha: string,
  path: string,
): Promise<BlobLoad> {
  const object = await query(entry, `${sha}:${path}`);
  if (!object.missing) {
    if (object.type !== "blob") return { kind: "defer" };
    return { kind: "blob", contents: object.contents };
  }
  const commit = await query(entry, sha);
  if (commit.missing || commit.type !== "commit") return { kind: "defer" };
  return { kind: "blob", contents: null };
}

async function showPath(
  workspace: string,
  sha: string,
  path: string,
): Promise<string | null> {
  try {
    return await runGit(["show", `${sha}:${path}`], workspace);
  } catch (err) {
    if (err instanceof IssueError && err.code === "git-failed") {
      if (isPathMissingAtCommitMessage(err.message)) return null;
      if (isCommitUnreachableMessage(err.message)) {
        throw new IssueError("commit-unreachable", err.message);
      }
    }
    throw err;
  }
}

async function readCached(
  entry: RepoEntry,
  sha: string,
  path: string,
): Promise<string | null> {
  const key = `${sha}\0${path}`;
  const cacheable = isFullCommitSha(sha);
  if (cacheable) {
    if (entry.cache.has(key)) return entry.cache.get(key) ?? null;
    const pending = entry.inflight.get(key);
    if (pending) return pending;
  }
  const pending = loadBlob(entry, sha, path).then((loaded) => {
    if (loaded.kind === "defer") return showPath(entry.workspace, sha, path);
    if (cacheable) entry.cache.set(key, loaded.contents);
    return loaded.contents;
  });
  if (!cacheable) return pending;
  entry.inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (entry.inflight.get(key) === pending) entry.inflight.delete(key);
  }
}

/**
 * File bytes at `sha:path`. Blob reads share one `git cat-file --batch` per
 * workspace. A full commit id is cached on `(sha, path)` because that blob
 * never changes. A missing commit or a non-blob falls through to `git show`
 * and is not cached.
 */
export async function readPathAtCommit(
  workspace: string,
  sha: string,
  path: string,
): Promise<string | null> {
  // `cat-file --batch` reads one object name per line, so newline or NUL goes to git show.
  if (nameBreaksBatchLine(sha) || nameBreaksBatchLine(path)) {
    return showPath(workspace, sha, path);
  }
  return readCached(repoEntry(workspace), sha, path);
}

/** @internal Stop every cat-file session started in this module copy. */
export function closeGitBlobSessionsForTests(): void {
  for (const entry of repos.values()) endEntry(entry);
  repos.clear();
}
