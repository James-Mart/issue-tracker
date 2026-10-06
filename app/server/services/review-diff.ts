import type { Issue } from "../schemas.js";
import type {
  ReviewCommitSummary,
  ReviewCommits,
  ReviewDiff,
  ReviewDiffFile,
  ReviewDiffStatus,
} from "../schemas/review.js";
import {
  maxPatchBytes,
  parseShortstat,
  prepareStoryChange,
  requireMergeBase,
  runGitOrCommitUnreachable,
  type StoryChangePreparation,
} from "./change.js";
import { IssueError } from "./errors.js";
import { readAll } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { resolveMergeBaseRef } from "./resolve-merge-base-ref.js";
import { readReviewView, requireStoryInProject } from "./reviews.js";

const COMMIT_META_FORMAT = "%an%x00%aI%x00%s";

type RawFile = {
  path: string;
  oldPath?: string;
  status: ReviewDiffStatus;
  blobSha: string;
};

type Numstat = {
  additions: number;
  deletions: number;
};

async function loadPrepared(
  projectId: string,
  storyId: string,
  issues: Issue[],
): Promise<{ storyId: string; workspace: string; prepared: StoryChangePreparation }> {
  requireStoryInProject(projectId, storyId, issues);
  const workspace = requireProjectWorkspace(projectId);
  const prepared = await prepareStoryChange(storyId, workspace, issues);
  return { storyId, workspace, prepared };
}

async function loadSpan(
  projectId: string,
  reviewId: string,
  issues: Issue[],
): Promise<{ storyId: string; workspace: string; prepared: StoryChangePreparation }> {
  const review = readReviewView(projectId, reviewId, issues);
  return loadPrepared(projectId, review.target.storyId, issues);
}

function nulRecords(text: string): string[] {
  if (text.length === 0) return [];
  const records = text.split("\0");
  if (records[records.length - 1] === "") records.pop();
  return records;
}

function statusOf(token: string): ReviewDiffStatus {
  if (token === "A") return "added";
  if (token === "M") return "modified";
  if (token === "D") return "deleted";
  if (token === "T") return "typechange";
  if (token.startsWith("R")) return "renamed";
  if (token.startsWith("C")) return "copied";
  throw new IssueError("git-failed", `unexpected diff status "${token}"`);
}

function isRenameOrCopy(token: string): boolean {
  return token.startsWith("R") || token.startsWith("C");
}

function parseRaw(text: string): RawFile[] {
  const records = nulRecords(text);
  const files: RawFile[] = [];
  let index = 0;
  while (index < records.length) {
    const meta = records[index++];
    const fields = meta.split(" ");
    const newSha = fields[3];
    const status = fields[4];
    if (!newSha || !status) {
      throw new IssueError("git-failed", `unexpected raw diff record "${meta}"`);
    }
    const firstPath = records[index++];
    if (firstPath === undefined) {
      throw new IssueError("git-failed", "raw diff ended before a path");
    }
    let path = firstPath;
    let oldPath: string | undefined;
    if (isRenameOrCopy(status)) {
      const dest = records[index++];
      if (dest === undefined) {
        throw new IssueError(
          "git-failed",
          "raw diff rename ended before the new path",
        );
      }
      oldPath = firstPath;
      path = dest;
    }
    files.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      status: statusOf(status),
      // git diff --raw prints an all-zero sha when the path has no post-image blob.
      blobSha: /^0+$/.test(newSha) ? "" : newSha,
    });
  }
  return files;
}

function countField(raw: string): number {
  // git numstat prints "-" for a binary file.
  if (raw === "-") return 0;
  if (!/^\d+$/.test(raw)) {
    throw new IssueError("git-failed", `unexpected numstat count "${raw}"`);
  }
  return Number(raw);
}

function parseNumstat(text: string): Numstat[] {
  const records = nulRecords(text);
  const stats: Numstat[] = [];
  let index = 0;
  while (index < records.length) {
    const head = records[index++];
    const fields = head.split("\t");
    if (fields.length !== 3) {
      throw new IssueError("git-failed", `unexpected numstat record "${head}"`);
    }
    const pathField = fields[2]!;
    if (pathField === "") {
      if (records[index] === undefined || records[index + 1] === undefined) {
        throw new IssueError("git-failed", "numstat rename ended before both paths");
      }
      index += 2;
    }
    stats.push({
      additions: countField(fields[0]!),
      deletions: countField(fields[1]!),
    });
  }
  return stats;
}

async function readParsedRaw(workspace: string, range: string): Promise<RawFile[]> {
  const rawText = await runGitOrCommitUnreachable(
    ["diff", "--raw", "--abbrev=40", "-z", range],
    workspace,
  );
  return parseRaw(rawText);
}

function listDiffFiles(raw: RawFile[], numstatText: string): Array<RawFile & Numstat> {
  const stats = parseNumstat(numstatText);
  if (raw.length !== stats.length) {
    throw new IssueError(
      "git-failed",
      `diff metadata mismatch: ${raw.length} names, ${stats.length} stats`,
    );
  }
  return raw.map((file, index) => ({
    ...file,
    additions: stats[index]!.additions,
    deletions: stats[index]!.deletions,
  }));
}

function patchSections(patch: string): string[] {
  if (patch.length === 0) return [];
  return patch.split(/^(?=diff --git )/m).filter((section) => section.length > 0);
}

function applyPatchCeiling(
  files: Array<RawFile & Numstat>,
  patch: string,
): { files: ReviewDiffFile[]; patch: string } {
  if (files.length === 0) {
    return { files: [], patch: "" };
  }
  const sections = patchSections(patch);
  if (sections.length !== files.length) {
    throw new IssueError(
      "git-failed",
      `diff metadata mismatch: ${files.length} files, ${sections.length} patch sections`,
    );
  }
  const ceiling = maxPatchBytes();
  const tooLarge = sections.map(
    (section) => Buffer.byteLength(section, "utf8") > ceiling,
  );
  const kept = tooLarge.some(Boolean)
    ? sections.filter((_, index) => !tooLarge[index]).join("")
    : patch;
  return {
    files: files.map((file, index) => ({
      path: file.path,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      blobSha: file.blobSha,
      tooLarge: tooLarge[index]!,
    })),
    patch: kept,
  };
}

async function readRangeDiff(
  workspace: string,
  range: string,
  scope: string,
): Promise<ReviewDiff> {
  const [raw, numstatText, patch] = await Promise.all([
    readParsedRaw(workspace, range),
    runGitOrCommitUnreachable(["diff", "--numstat", "-z", range], workspace),
    runGitOrCommitUnreachable(["diff", range], workspace),
  ]);
  const applied = applyPatchCeiling(listDiffFiles(raw, numstatText), patch);
  return { scope, files: applied.files, patch: applied.patch };
}

async function readOneCommit(
  sha: string,
  workspace: string,
): Promise<ReviewCommitSummary> {
  const [meta, statOut] = await Promise.all([
    runGitOrCommitUnreachable(
      ["show", "-s", `--format=${COMMIT_META_FORMAT}`, sha],
      workspace,
    ),
    runGitOrCommitUnreachable(
      ["diff", "--shortstat", `${sha}^..${sha}`],
      workspace,
    ),
  ]);
  const text = meta.endsWith("\n") ? meta.slice(0, -1) : meta;
  const parts = text.split("\0");
  if (parts.length !== 3 || parts[0] === "" || parts[1] === "") {
    throw new IssueError("git-failed", `unexpected commit metadata for ${sha}`);
  }
  const stats = parseShortstat(statOut);
  return {
    sha,
    subject: parts[2]!,
    author: parts[0],
    authoredAt: parts[1],
    files: stats.filesChanged,
    additions: stats.insertions,
    deletions: stats.deletions,
  };
}

export function refuseForeignSha(scope: string): never {
  throw new IssueError(
    "validation",
    `sha "${scope}" is not one of this story's commits`,
  );
}

export async function readReviewCommits(
  projectId: string,
  reviewId: string,
): Promise<ReviewCommits> {
  const loaded = await loadSpan(projectId, reviewId, readAll().issues);
  const { storyId, workspace } = loaded;
  const prepared = requireMergeBase(storyId, loaded.prepared);
  if (prepared.state === "empty") {
    const mergeBaseRef = await resolveMergeBaseRef(workspace, prepared.mergeBase);
    return {
      mergeBase: prepared.mergeBase,
      mergeBaseRef,
      tip: "",
      commits: [],
    };
  }
  const commits = await Promise.all(
    prepared.shas.map((sha) => readOneCommit(sha, workspace)),
  );
  return {
    mergeBase: prepared.mergeBase,
    mergeBaseRef: prepared.mergeBaseRef,
    tip: prepared.tip,
    commits,
  };
}

export async function readReviewDiff(
  projectId: string,
  reviewId: string,
  scope: string,
): Promise<ReviewDiff> {
  const loaded = await loadSpan(projectId, reviewId, readAll().issues);
  const prepared = requireMergeBase(loaded.storyId, loaded.prepared);
  if (prepared.state === "empty") {
    if (scope !== "all") refuseForeignSha(scope);
    return { scope: "all", files: [], patch: "" };
  }
  if (scope !== "all" && !prepared.shas.includes(scope)) {
    refuseForeignSha(scope);
  }
  const range =
    scope === "all" ? prepared.range : await parentRange(scope, loaded.workspace);
  return readRangeDiff(loaded.workspace, range, scope);
}

async function parentRange(sha: string, workspace: string): Promise<string> {
  const parent = (
    await runGitOrCommitUnreachable(["rev-parse", `${sha}^`], workspace)
  ).trim();
  return `${parent}..${sha}`;
}

export type DiffBlob = {
  path: string;
  blobSha: string;
};

/** Post-image path and blob for each file in a diff range. */
export async function readDiffBlobs(workspace: string, range: string): Promise<DiffBlob[]> {
  const raw = await readParsedRaw(workspace, range);
  return raw.map((file) => ({ path: file.path, blobSha: file.blobSha }));
}

export type ReviewChangeSpan =
  | { state: "empty" }
  | {
      state: "ready";
      workspace: string;
      allRange: string;
      commits: Array<{ sha: string; range: string }>;
    };

/** Whole-review range and each Story commit's parent range, without re-reading the review. */
export async function loadReviewChangeSpan(
  projectId: string,
  storyId: string,
  issues?: Issue[],
): Promise<ReviewChangeSpan> {
  const loaded = await loadPrepared(projectId, storyId, issues ?? readAll().issues);
  const prepared = requireMergeBase(loaded.storyId, loaded.prepared);
  if (prepared.state === "empty") return { state: "empty" };
  const commits = await Promise.all(
    prepared.shas.map(async (sha) => ({
      sha,
      range: await parentRange(sha, loaded.workspace),
    })),
  );
  return {
    state: "ready",
    workspace: loaded.workspace,
    allRange: prepared.range,
    commits,
  };
}
