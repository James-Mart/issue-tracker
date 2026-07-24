import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoOverviewStructure } from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

async function openNewEpicDialog(page: Page): Promise<void> {
  await page
    .getByRole("tabpanel", { name: "Structure" })
    .getByRole("button", { name: "New epic" })
    .click();
  const dialog = page.getByTestId("new-issue-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "New epic" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Add an Epic under this project."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
}

async function openNewProjectDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByTestId("project-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "New project" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Name the project and group related epics."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
}

async function openRenameProjectDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByTestId("project-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Rename project" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Update the project name shown across the plan."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
}

async function openDeleteEpicDialog(page: Page, baseURL: string): Promise<void> {
  await gotoOverviewStructure(page, baseURL);
  const epicBRow = page.locator(".group", {
    has: page.getByRole("link", { name: "Epic B" }),
  });
  await epicBRow.hover();
  await epicBRow.getByTitle("Delete").click();
  const dialog = page.getByTestId("delete-issue-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Delete epic" }),
  ).toBeVisible();
  await expect(
    dialog.getByText(/and 3 contained issues/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete 4 issues" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
}

test.describe("project dialog", () => {
  test("creates a project via the dialog", async ({ page, seededApp }) => {
    await page.goto(seededApp.baseURL);
    await openNewProjectDialog(page);

    const dialog = page.getByTestId("project-dialog");
    await dialog.getByLabel("Title").fill("Project from dialog");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/projects\/project-from-dialog\/?$/);
    await expect(
      page.getByRole("link", { name: "Project from dialog" }),
    ).toBeVisible();
  });

  test("renames a project via the dialog", async ({ page, seededApp }) => {
    await page.goto(`${seededApp.baseURL}/projects/seed-proj`);
    await openRenameProjectDialog(page);

    const dialog = page.getByTestId("project-dialog");
    await dialog.getByLabel("Title").fill("Renamed Seed Project");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Renamed Seed Project" }),
    ).toBeVisible();
  });

  // Sole both-theme key-surface snapshot for the project dialog.
  test("both-theme project dialog snapshot", async ({ page, seededApp }) => {
    await page.goto(seededApp.baseURL);
    await snapshotBothThemes(page, "project-dialog", async () => {
      await openNewProjectDialog(page);
      await expect(page.getByTestId("project-dialog")).toBeVisible();
    });
  });
});

test.describe("new-issue dialog", () => {
  test("creates an Epic via the dialog", async ({ page, seededApp }) => {
    await gotoOverviewStructure(page, seededApp.baseURL);
    await openNewEpicDialog(page);

    const dialog = page.getByTestId("new-issue-dialog");
    await dialog.getByLabel("Title").fill("Epic from dialog");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByRole("tabpanel", { name: "Structure" })
        .getByRole("link", { name: /^Epic from dialog\b/ }),
    ).toBeVisible();
  });

  // Sole both-theme key-surface snapshot for the new-issue dialog.
  test("both-theme new-issue dialog snapshot", async ({ page, seededApp }) => {
    await gotoOverviewStructure(page, seededApp.baseURL);
    await snapshotBothThemes(page, "new-issue-dialog", async () => {
      await openNewEpicDialog(page);
      await expect(page.getByTestId("new-issue-dialog")).toBeVisible();
    });
  });
});

test.describe("delete confirmation dialog", () => {
  test.describe.configure({ mode: "serial" });

  // Sole both-theme key-surface snapshot for the delete confirmation dialog.
  // Runs before destructive deletes so worker-scoped seed-epic-b stays intact.
  test("both-theme delete dialog snapshot", async ({ page, seededApp }) => {
    await page.goto(seededApp.baseURL);
    await snapshotBothThemes(page, "delete-issue-dialog", async () => {
      await openDeleteEpicDialog(page, seededApp.baseURL);
      await expect(page.getByTestId("delete-issue-dialog")).toBeVisible();
    });
  });

  test("deletes an epic and its contained issues", async ({ page, seededApp }) => {
    await openDeleteEpicDialog(page, seededApp.baseURL);

    const dialog = page.getByTestId("delete-issue-dialog");
    await dialog.getByRole("button", { name: "Delete 4 issues" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Epic B" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Story in flight" })).toHaveCount(
      0,
    );
  });

  test("deletes a leaf issue via the dialog", async ({ page, seededApp }) => {
    const storyRes = await page.request.post(`${seededApp.baseURL}/api/issues`, {
      data: {
        kind: "story",
        title: "Leaf delete story",
        partOf: "seed-epic-a",
      },
    });
    expect(storyRes.ok()).toBeTruthy();
    const { id: storyId } = await storyRes.json();

    const createRes = await page.request.post(`${seededApp.baseURL}/api/issues`, {
      data: {
        kind: "task",
        title: "Leaf delete target",
        partOf: storyId,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id: taskId } = await createRes.json();

    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/${taskId}`,
    );
    await page.locator("header").getByRole("button").last().click();

    const dialog = page.getByTestId("delete-issue-dialog");
    await expect(
      dialog.getByRole("heading", { name: "Delete task" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Leaf delete target")).toHaveCount(0);
  });
});
