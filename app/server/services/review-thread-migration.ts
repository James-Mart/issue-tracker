import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { ConversationMeta } from "../schemas.js";
import type { ReviewIssue } from "../schemas/review.js";
import { storedConversationMetas } from "./conversation-ids.js";
import { persistConversationMeta } from "./conversation-meta-index.js";
import { commentsJsonPath } from "./issues-file.js";
import { buildReviewIssue, storedReviewForStory } from "./reviews.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
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

const MIGRATION_FLAG = ".review-threads-migrated";

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

/**
 * Thread roots code review owns: an anchored root, a root with a thread kind,
 * a root a submission names (its threads or its summary), or a root with a
 * thread event. Human-request threads and comments with `source` stay on the Story.
 */
function reviewRootIds(lines: readonly LogLine[], review: ReviewIssue | undefined): Set<string> {
  const claimed = new Set(
    (review?.submissions ?? []).flatMap((submission) => [
      ...submission.threadIds,
      ...(submission.summaryCommentId ? [submission.summaryCommentId] : []),
    ]),
  );
  const withEvents = new Set(
    lines.flatMap(({ record }) => {
      const threadId =
        record?.type === "thread-event" ? stringField(record, "threadId") : undefined;
      return threadId ? [threadId] : [];
    }),
  );
  const roots = new Set<string>();
  for (const { record } of lines) {
    if (!record || !isComment(record) || record.replyTo !== undefined) continue;
    const id = stringField(record, "id");
    if (!id) continue;
    if (record.type === "human-request" || record.source !== undefined) continue;
    if (
      record.anchor !== undefined ||
      record.kind !== undefined ||
      claimed.has(id) ||
      withEvents.has(id)
    ) {
      roots.add(id);
    }
  }
  return roots;
}

/**
 * One-time: move each Story's review threads and review-channel conversations
 * onto the Story's review issue, creating that review when the Story has none.
 * Other Story comments stay. A line already on the review (an interrupted run)
 * is not appended again.
 */
export function ensureReviewThreadsMigrated(): void {
  if (existsSync(flagPath())) return;

  const issues = [...forEachOnDiskIssue()].map(({ issue }) => issue);
  const taken = new Set(existsSync(issuesDir) ? readdirSync(issuesDir) : []);
  const conversations = storedConversationMetas().filter(
    (meta) => meta.channel === "review" && meta.issueId !== undefined,
  );
  const now = new Date().toISOString();
  const created: ReviewIssue[] = [];
  const moves: StoryMove[] = [];
  const retargets: ConversationMeta[] = [];

  for (const story of issues) {
    if (story.kind !== "story") continue;
    const lines = readLogLines(commentsJsonPath(story.id));
    const graph = [...issues, ...created];
    const existing = storedReviewForStory(story.id, graph);
    const roots = reviewRootIds(lines, existing);
    const storyConversations = conversations.filter((meta) => meta.issueId === story.id);
    if (roots.size === 0 && storyConversations.length === 0) continue;

    let review = existing;
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
    for (const meta of storyConversations) retargets.push({ ...meta, issueId: review.id });
  }

  persistStoryCommentMoves(created, moves);
  for (const meta of retargets) persistConversationMeta(meta);

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}
