import { expect, test } from "./fixtures";

test("posts a comment from issue detail", async ({ page, seededApp }) => {
  await page.goto(`${seededApp.baseURL}/projects/seed-proj/issues/seed-story`);
  const main = page.getByRole("main");
  const comments = main.locator('[data-region="comments"]');
  await expect(comments.getByText("No comments yet.")).toBeVisible();

  const message = "E2E comment from Playwright";
  await comments.getByRole("textbox", { name: "Add a comment" }).fill(message);
  await comments.getByRole("button", { name: "Send" }).click();

  await expect(comments.getByText(message)).toBeVisible();
  await expect(comments.getByText("No comments yet.")).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Jump to 1 comment" }),
  ).toBeVisible();
});
