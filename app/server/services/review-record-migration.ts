import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { z } from "zod";
import { issuesDir } from "../config.js";
import { formatZodError, parseIssue, type Issue } from "../schemas.js";
import { reviewMarksSchema, reviewSubmissionSchema } from "../schemas/review-state.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import { replaceFileAtomically } from "./issues-store-lock.js";
import { compareReviewsByCreated } from "./review-lifecycle.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

const MIGRATION_FLAG = ".review-records-migrated";

const nonEmpty = z.string().min(1);

/** A review as stored at `<projectId>/reviews/<reviewId>.json` before reviews were issues. */
const reviewRecordSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    target: z.object({ kind: z.literal("story"), storyId: nonEmpty }).strict(),
    status: z.enum(["open", "archived"]),
    postMortem: z.boolean(),
    createdAt: nonEmpty,
    updatedAt: nonEmpty,
    marks: reviewMarksSchema,
    submissions: z.array(reviewSubmissionSchema).default([]),
  })
  .strict();

type ReviewRecord = z.infer<typeof reviewRecordSchema>;

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

function refuse(path: string, reason: string): never {
  throw new IssueError("validation", `cannot migrate review record ${path}: ${reason}`);
}

function readRecord(path: string, projectId: string): ReviewRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    refuse(path, err instanceof Error ? err.message : String(err));
  }
  const parsed = reviewRecordSchema.safeParse(raw);
  if (!parsed.success) refuse(path, formatZodError(parsed.error, "invalid review"));
  const record = parsed.data;
  if (record.id !== basename(path, ".json")) {
    refuse(path, `id "${record.id}" does not match the file name`);
  }
  if (record.projectId !== projectId) {
    refuse(path, `projectId "${record.projectId}" is not "${projectId}"`);
  }
  return record;
}

/**
 * One-time: turn every stored review record into a `review` issue with the
 * same id, then remove each Project's `reviews/` directory. Every record is
 * validated before anything is written. A review that read as archived
 * (explicitly, or because its Story merged outside a post-mortem) is stored
 * archived. A record that was converted by an interrupted run is skipped.
 */
export function ensureReviewRecordsMigrated(): void {
  if (existsSync(flagPath())) return;

  const byId = new Map<string, Issue>();
  for (const { issue } of forEachOnDiskIssue()) byId.set(issue.id, issue);

  const nextOrder = new Map<string, number>();
  for (const issue of byId.values()) {
    if (issue.kind !== "review") continue;
    nextOrder.set(
      issue.partOf,
      Math.max(nextOrder.get(issue.partOf) ?? 0, issue.order + 1),
    );
  }

  const recordDirs: string[] = [];
  const converted: { path: string; issue: Issue }[] = [];
  for (const project of byId.values()) {
    if (project.kind !== "project") continue;
    const dir = join(issuesDir, project.id, "reviews");
    if (!existsSync(dir)) continue;
    recordDirs.push(dir);
    const records = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const path = join(dir, name);
        return { path, record: readRecord(path, project.id) };
      })
      .sort((a, b) => compareReviewsByCreated(a.record, b.record));
    for (const { path, record } of records) {
      const storyId = record.target.storyId;
      const existing = byId.get(record.id);
      if (existing?.kind === "review" && existing.story === storyId) continue;
      if (existsSync(join(issuesDir, record.id))) {
        refuse(path, `issue "${record.id}" already exists`);
      }
      const story = byId.get(storyId);
      if (story?.kind !== "story") refuse(path, `story "${storyId}" is not a story`);
      const order = nextOrder.get(project.id) ?? 0;
      nextOrder.set(project.id, order + 1);
      const parsed = parseIssue({
        id: record.id,
        kind: "review",
        partOf: project.id,
        title: story.title,
        story: storyId,
        archived:
          record.status === "archived" || (story.merged && !record.postMortem),
        marks: record.marks,
        submissions: record.submissions,
        order,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      if (!parsed.ok) refuse(path, parsed.message);
      converted.push({ path, issue: parsed.issue });
    }
  }

  const problems = checkIntegrity([...byId.values(), ...converted.map(({ issue }) => issue)]);
  for (const { path, issue } of converted) {
    const own = problems.filter((problem) => problem.id === issue.id);
    if (own.length > 0) refuse(path, own.map((problem) => problem.message).join("; "));
  }

  for (const { issue } of converted) {
    mkdirSync(join(issuesDir, issue.id), { recursive: true });
    replaceFileAtomically(
      join(issuesDir, issue.id, "issue.json"),
      `${JSON.stringify(issue, null, 2)}\n`,
    );
  }
  for (const dir of recordDirs) rmSync(dir, { recursive: true, force: true });

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}
