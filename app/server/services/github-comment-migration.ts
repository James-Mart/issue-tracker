import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { ReviewIssue } from "../schemas/review.js";
import { commentsJsonPath } from "./issues-file.js";
import { withIssuesStoreLock } from "./issues-store-lock.js";
import { buildReviewIssue, storedReviewForStory } from "./reviews.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
import { refusesStoreWrites } from "./store-read-only.js";
import {
  isComment,
  persistStoryCommentMoves,
  readLogLines,
  splitStoryLog,
  stringField,
  type LogLine,
  type StoryMove,
} from "./story-comment-move.js";
import { ancestorChain } from "./subtree.js";

const MIGRATION_FLAG = ".github-comments-migrated";

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

/**
 * Roots of threads that contain a mirrored comment. A local reply to that
 * root moves with it, because `replyTo` names the root.
 */
function mirroredRootIds(lines: readonly LogLine[]): Set<string> {
  const roots = new Set<string>();
  for (const { record } of lines) {
    if (!record || !isComment(record) || record.source === undefined) continue;
    const id = stringField(record, "id");
    if (!id) continue;
    roots.add(stringField(record, "replyTo") ?? id);
  }
  return roots;
}

function migrate(): void {
  if (existsSync(flagPath())) return;

  const issues = [...forEachOnDiskIssue()].map(({ issue }) => issue);
  const taken = new Set(existsSync(issuesDir) ? readdirSync(issuesDir) : []);
  const now = new Date().toISOString();
  const created: ReviewIssue[] = [];
  const moves: StoryMove[] = [];

  for (const story of issues) {
    if (story.kind !== "story") continue;
    const lines = readLogLines(commentsJsonPath(story.id));
    const roots = mirroredRootIds(lines);
    if (roots.size === 0) continue;

    const graph = [...issues, ...created];
    let review = storedReviewForStory(story.id, graph);
    if (!review) {
      review = buildReviewIssue(story, ancestorChain(story.id, graph)[0]!.id, graph, taken, {
        archived: story.merged || story.archived,
        now,
      });
      taken.add(review.id);
      created.push(review);
    }
    const { keep, move } = splitStoryLog(lines, roots);
    if (move.length > 0) moves.push({ storyId: story.id, reviewId: review.id, keep, move });
  }

  persistStoryCommentMoves(created, moves);
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

/**
 * One-time: move GitHub-mirrored comment threads off Stories onto the Story's
 * review, creating that review when the Story has none. Other Story comments
 * stay. A line already on the review is not appended again.
 */
export function ensureGithubCommentsMigrated(): void {
  if (refusesStoreWrites()) return;
  if (existsSync(flagPath())) return;
  withIssuesStoreLock(migrate);
}
