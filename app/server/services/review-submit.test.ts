import { describe, expect, it } from "vitest";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking,
  useReviewTaskingStore,
  writeReviewTaskingIssue as writeIssue,
} from "./review-tasking.test-fixtures.js";

function seed(): void {
  seedReviewTasking();
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    branchName: "story-branch",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const submit = await import("./review-submit.js");
  const issues = await import("./issues.js");
  return { ...submit, ...issues };
}

describe("submit review", () => {
  useReviewTaskingStore("issue-tracker-review-submit-");

  it("refuses a removed idea destination", async () => {
    seed();
    const { submitReview, appendComment } = await load();
    await appendComment(REVIEW_ID, { role: "human", body: "Take this." });
    await expect(
      submitReview("p", REVIEW_ID, { destination: "idea" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("records a tasking submission with an empty body", async () => {
    seed();
    const { submitReview, appendComment } = await load();
    await appendComment(REVIEW_ID, { role: "human", body: "Take this." });
    const view = await submitReview("p", REVIEW_ID, {});
    expect(view.submissions[0]).toMatchObject({
      status: "tasking",
      threadIds: expect.any(Array),
    });
  });
});
