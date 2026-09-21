import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function ensureSeedProjectWorkspace(
  page: Page,
  baseURL: string,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-agents-history-ws-"));
  mkdirSync(join(workspace, ".git"));
  const res = await page.request.patch(`${baseURL}/api/issues/seed-proj`, {
    data: { workspace },
  });
  expect(res.ok()).toBeTruthy();
}

async function createAgentConversation(
  page: Page,
  baseURL: string,
  title: string,
): Promise<string> {
  const res = await page.request.post(`${baseURL}/api/conversations`, {
    data: {
      projectId: "seed-proj",
      title,
      model: "composer-2.5",
    },
  });
  if (!res.ok()) {
    throw new Error(
      `create conversation failed: ${res.status()} ${await res.text()}`,
    );
  }
  const { id } = (await res.json()) as { id: string };
  return id;
}

function conversationButton(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Conversations" })
    .getByRole("button")
    .filter({ hasText: title });
}

test.describe("agents selection history", () => {
  test("reload keeps the open thread and browser back restores the prior conversation on desktop", async ({
    page,
    seededApp,
  }) => {
    await ensureSeedProjectWorkspace(page, seededApp.baseURL);
    const titleA = `History A ${Date.now()}`;
    const titleB = `History B ${Date.now()}`;
    const idA = await createAgentConversation(page, seededApp.baseURL, titleA);
    const idB = await createAgentConversation(page, seededApp.baseURL, titleB);

    await page.goto(`${seededApp.baseURL}/agents`);
    await expect(page.getByRole("region", { name: "Conversations" })).toBeVisible();

    await conversationButton(page, titleA).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${idA}$`));
    await expect(page.getByTestId("conversation-thread")).toBeVisible();

    await conversationButton(page, titleB).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${idB}$`));
    await expect(page.getByTestId("open-thread-chrome")).toContainText(titleB);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/agents/${idB}$`));
    await expect(page.getByTestId("conversation-thread")).toBeVisible();
    await expect(page.getByTestId("open-thread-chrome")).toContainText(titleB);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/agents/${idA}$`));
    await expect(page.getByTestId("conversation-thread")).toBeVisible();
    await expect(page.getByTestId("open-thread-chrome")).toContainText(titleA);
  });
});

test.describe("agents selection history at phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("reload keeps the open thread and browser back returns to the roster", async ({
    page,
    seededApp,
  }) => {
    await ensureSeedProjectWorkspace(page, seededApp.baseURL);
    const title = `Phone history ${Date.now()}`;
    const id = await createAgentConversation(page, seededApp.baseURL, title);

    await page.goto(`${seededApp.baseURL}/agents`);
    await conversationButton(page, title).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.getByTestId("conversation-thread")).toBeVisible();
    await expect(page.getByRole("region", { name: "Conversations" })).toBeHidden();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.getByTestId("conversation-thread")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/agents/?$`));
    await expect(page.getByRole("region", { name: "Conversations" })).toBeVisible();
    await expect(page.getByTestId("conversation-thread")).toBeHidden();
  });

  test("the in-thread back control returns to the roster", async ({
    page,
    seededApp,
  }) => {
    await ensureSeedProjectWorkspace(page, seededApp.baseURL);
    const title = `Phone back ${Date.now()}`;
    const id = await createAgentConversation(page, seededApp.baseURL, title);

    await page.goto(`${seededApp.baseURL}/agents/${id}`);
    await expect(page.getByTestId("conversation-thread")).toBeVisible();

    await page.getByRole("button", { name: "Back to conversations" }).click();
    await expect(page).toHaveURL(new RegExp(`/agents/?$`));
    await expect(page.getByRole("region", { name: "Conversations" })).toBeVisible();
    await expect(page.getByTestId("conversation-thread")).toBeHidden();
  });
});
