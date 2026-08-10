import { devices, type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoSeedStoryDetail } from "./seed-navigation";

function commentsRegion(main: Locator): Locator {
  return main.locator('[data-region="comments"]');
}

async function documentOverflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
}

async function expectCommentsBelowDescription(main: Locator): Promise<void> {
  const follows = await main.evaluate(() => {
    const description = [...document.querySelectorAll("main p")].find(
      (paragraph) => paragraph.textContent === "Description",
    );
    const comments = document.querySelector('[data-region="comments"]');
    if (!description || !comments) return false;
    return Boolean(
      description.compareDocumentPosition(comments) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(follows).toBe(true);
}

const VIEWPORTS = [
  { label: "desktop", width: 1280, height: 720 },
  {
    label: "phone",
    width: devices["Pixel 5"].viewport.width,
    height: devices["Pixel 5"].viewport.height,
    hasTouch: true,
    isMobile: true,
  },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`issue comments at ${viewport.label} width`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.hasTouch
        ? { hasTouch: viewport.hasTouch, isMobile: viewport.isMobile }
        : {}),
    });

    test("inline thread, post, anchor jump, no companion", async ({
      page,
      seededApp,
    }) => {
      const main = await gotoSeedStoryDetail(
        page,
        seededApp.baseURL,
        "seed-story-merged",
        "Merged story",
      );
      const comments = commentsRegion(main);

      await expect(main.locator('[data-region="companion"]')).toHaveCount(0);
      expect(
        await documentOverflowsHorizontally(page),
        "issue detail scrolls sideways",
      ).toBe(false);

      await expectCommentsBelowDescription(main);
      await expect(comments).toBeVisible();
      await expect(comments.getByText("Comments", { exact: true })).toBeVisible();
      await expect(comments.getByText("No comments yet.")).toBeVisible();

      const anchor = main.getByRole("link", { name: "Jump to 0 comments" });
      await expect(anchor).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await anchor.click();
      await expect(comments).toBeInViewport();

      const composer = comments.getByRole("textbox", { name: "Add a comment" });
      await expect(composer).toBeVisible();
      const message = "E2E comment from Playwright";
      await composer.fill(message);
      await comments.getByRole("button", { name: "Send" }).click();

      await expect(main.getByText(message)).toBeVisible();
      await expect(comments.getByText("No comments yet.")).toHaveCount(0);
      await expect(
        main.getByRole("link", { name: "Jump to 1 comment" }),
      ).toBeVisible();
    });
  });
}
