import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function ensureSeedProjectWorkspace(
  page: Page,
  baseURL: string,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-multi-tab-ws-"));
  mkdirSync(join(workspace, ".git"));
  const res = await page.request.patch(`${baseURL}/api/issues/seed-proj`, {
    data: { workspace },
  });
  expect(res.ok()).toBeTruthy();
}

async function createChannelSession(
  page: Page,
  baseURL: string,
  issueId: string,
  channel: "planning" | "implementing",
): Promise<string> {
  const title = `Multi-tab ${issueId} ${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const created = await page.request.post(
    `${baseURL}/api/issues/${issueId}/channels/${channel}/sessions`,
    {
      data: {
        model: "composer-2.5",
        title,
      },
    },
  );
  if (!created.ok()) {
    throw new Error(
      `create channel session failed: ${created.status()} ${await created.text()}`,
    );
  }
  const { id } = (await created.json()) as { id: string };
  return id;
}

async function connectionCount(page: Page, baseURL: string): Promise<number> {
  const res = await page.request.get(
    `${baseURL}/api/diagnostics/connections`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { connections: number };
  return body.connections;
}

async function openIssueChannel(
  page: Page,
  baseURL: string,
  issueId: string,
): Promise<void> {
  await page.goto(
    `${baseURL}/projects/seed-proj/issues/${issueId}?tab=implementing`,
  );
  const main = page.getByRole("main");
  await expect(
    main.getByRole("tab", { name: "Implementing" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(main.getByTestId("channel-transcript-panel")).toBeVisible();
}

async function waitForConnections(
  page: Page,
  baseURL: string,
  expected: number,
): Promise<void> {
  await expect
    .poll(async () => connectionCount(page, baseURL), {
      message: `expected ${expected} upstream connection(s)`,
      timeout: 15_000,
    })
    .toBe(expected);
}

async function deleteConversation(
  page: Page,
  baseURL: string,
  id: string,
): Promise<void> {
  const res = await page.request.delete(
    `${baseURL}/api/conversations/${id}`,
  );
  expect(res.ok()).toBeTruthy();
}

test.describe("multi-tab SharedWorker connection", () => {
  test("three tabs share one upstream connection and a background tab stays live", async ({
    browser,
    seededApp,
  }) => {
    const { baseURL } = seededApp;
    const context = await browser.newContext();
    const setup = await context.newPage();
    const sessionIds: string[] = [];
    try {
      await ensureSeedProjectWorkspace(setup, baseURL);

      const conversationA = await createChannelSession(
        setup,
        baseURL,
        "seed-epic-a",
        "implementing",
      );
      sessionIds.push(
        conversationA,
        await createChannelSession(
          setup,
          baseURL,
          "seed-epic-b",
          "implementing",
        ),
        await createChannelSession(
          setup,
          baseURL,
          "seed-epic-c",
          "implementing",
        ),
      );

      const background = await context.newPage();
      const driver = await context.newPage();
      const third = await context.newPage();

      await Promise.all([
        openIssueChannel(background, baseURL, "seed-epic-a"),
        openIssueChannel(driver, baseURL, "seed-epic-a"),
        openIssueChannel(third, baseURL, "seed-epic-b"),
      ]);

      await waitForConnections(driver, baseURL, 1);

      const implementingTab = background
        .getByRole("main")
        .getByRole("tab", { name: "Implementing" });
      await expect(implementingTab).not.toHaveAttribute(
        "data-channel-tab-indicator",
        "active-run",
      );

      // Leave `background` alone; drive a run from the foreground page's
      // conversation. The seeded server shares this process, so publish the same
      // live run frame a real send would emit.
      await driver.bringToFront();
      const { publishFrame } = await import(
        "../server/services/conversation-stream.js"
      );
      publishFrame(conversationA, {
        event: { type: "run", status: "started", runId: "e2e-multi-tab-run" },
        persist: false,
      });

      await expect(implementingTab).toHaveAttribute(
        "data-channel-tab-indicator",
        "active-run",
        { timeout: 15_000 },
      );
      await expect(
        implementingTab.getByTestId("roster-active-run"),
      ).toBeVisible();

      expect(await connectionCount(driver, baseURL)).toBe(1);
    } finally {
      // Worker-scoped seed dir is shared with other seeded specs — remove the
      // sessions this test created so empty-state checks stay valid.
      for (const id of sessionIds) {
        await deleteConversation(setup, baseURL, id);
      }
      await context.close();
    }
  });

  test("forcing SharedWorker off yields one connection per page", async ({
    browser,
    seededApp,
  }) => {
    const { baseURL } = seededApp;
    const context = await browser.newContext();
    await context.addInitScript(() => {
      // Same gate as transport.ts (`typeof SharedWorker !== "undefined"`).
      Object.defineProperty(window, "SharedWorker", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });

    const setup = await context.newPage();
    const sessionIds: string[] = [];
    try {
      await ensureSeedProjectWorkspace(setup, baseURL);
      sessionIds.push(
        await createChannelSession(
          setup,
          baseURL,
          "seed-epic-a",
          "implementing",
        ),
        await createChannelSession(
          setup,
          baseURL,
          "seed-epic-b",
          "implementing",
        ),
        await createChannelSession(
          setup,
          baseURL,
          "seed-epic-c",
          "implementing",
        ),
      );

      const pages = await Promise.all([
        context.newPage(),
        context.newPage(),
        context.newPage(),
      ]);
      await Promise.all([
        openIssueChannel(pages[0], baseURL, "seed-epic-a"),
        openIssueChannel(pages[1], baseURL, "seed-epic-b"),
        openIssueChannel(pages[2], baseURL, "seed-epic-c"),
      ]);

      await waitForConnections(pages[0], baseURL, 3);
    } finally {
      for (const id of sessionIds) {
        await deleteConversation(setup, baseURL, id);
      }
      await context.close();
    }
  });
});
