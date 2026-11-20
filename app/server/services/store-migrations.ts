import type { Issue } from "../schemas.js";
import { ensureArchivedBackfilled } from "./archived.js";
import { ensureGithubCommentsMigrated } from "./github-comment-migration.js";
import { ensureKindRenamed } from "./kind-rename.js";
import { ensureMergeBaseStripped } from "./merge-base.js";
import { ensureMergedAtBackfilled } from "./merge-consequences.js";
import { ensureOutlineChannelsMigrated } from "./outline-channel-migration.js";
import { ensurePlanSettingsMigrated } from "./plan-settings-migration.js";
import { ensureReviewRecordsMigrated } from "./review-record-migration.js";
import { ensureReleaseMigrated } from "./release-migration.js";
import { ensureReviewThreadsMigrated } from "./review-thread-migration.js";
import { ensureSourceIdeaMigrated } from "./source-idea-migration.js";
import { refusesStoreWrites } from "./store-read-only.js";
import { ensureSpecReviewRenamed } from "./story-review.js";
import { ensureWorkQueuePositionsBackfilled } from "./work-queue.js";

/**
 * Run every one-shot on-disk migration. Each no-ops after its marker exists.
 * `persistIssue` rewrites one parsed issue's issue.json in place.
 */
export function runStoreMigrations(persistIssue: (issue: Issue) => void): void {
  if (refusesStoreWrites()) return;
  // Kind rename must run before parseIssue-based migrations (old kinds won't parse).
  ensureKindRenamed();
  ensureMergeBaseStripped(persistIssue);
  ensureArchivedBackfilled(persistIssue);
  ensureMergedAtBackfilled(persistIssue);
  ensureSpecReviewRenamed();
  ensureSourceIdeaMigrated();
  ensurePlanSettingsMigrated(persistIssue);
  ensureReviewRecordsMigrated();
  ensureReviewThreadsMigrated();
  ensureOutlineChannelsMigrated();
  ensureGithubCommentsMigrated();
  ensureWorkQueuePositionsBackfilled(persistIssue);
  ensureReleaseMigrated(persistIssue);
}
