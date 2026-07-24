import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function gotoSeedStoryDetail(
  page: Page,
  baseURL: string,
  storyId = "seed-story-flight",
  title = "Story in flight",
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/${storyId}`);
  const main = page.getByRole("main");
  await expect(main.getByText("Story", { exact: true }).first()).toBeVisible();
  await expect(main.getByText(title).first()).toBeVisible();
  return main;
}

export async function gotoSeedEpicDetail(
  page: Page,
  baseURL: string,
  epicId = "seed-epic-b",
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/${epicId}`);
  const main = page.getByRole("main");
  await expect(main.getByText("Epic", { exact: true }).first()).toBeVisible();
  return main;
}

export async function gotoOverviewStructure(
  page: Page,
  baseURL: string,
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj?lens=structure`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Seed Project" })).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Overview lens" }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Structure" })).toBeVisible();
  return main;
}
