import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function documentOverflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
}

async function ensureSeedProjectWorkspace(
  page: Page,
  baseURL: string,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-channel-ws-"));
  mkdirSync(join(workspace, ".git"));
  const res = await page.request.patch(
    `${baseURL}/api/issues/seed-proj`,
    { data: { workspace } },
  );
  expect(res.ok()).toBeTruthy();
}

async function seedChannelTranscript(
  page: Page,
  baseURL: string,
  issueId: string,
  channel: "planning" | "implementing",
): Promise<string> {
  await ensureSeedProjectWorkspace(page, baseURL);
  const title = `Channel e2e ${issueId} ${Date.now()}-${Math.random()
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

  const { conversationsDir } = await import("../server/config.js");
  const transcriptPath = join(conversationsDir, id, "transcript.jsonl");
  const at = "2026-08-10T12:00:00.000Z";
  for (let i = 0; i < 40; i++) {
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        text: `Transcript block ${i}. ${"x".repeat(120)}`,
        at,
      })}\n`,
    );
  }
  return id;
}

/**
 * Stand in for `visualViewport` so a test can shrink the visible band the way a
 * soft keyboard does. Headless Chromium has no keyboard to raise.
 */
async function stubSoftKeyboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const band = { covered: 0 };
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        get height() {
          return window.innerHeight - band.covered;
        },
        offsetTop: 0,
        scale: 1,
        addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_event: string, cb: () => void) =>
          listeners.delete(cb),
      },
    });
    Object.assign(window, {
      __coverWithKeyboard(covered: number) {
        band.covered = covered;
        for (const cb of [...listeners]) cb();
      },
    });
  });
}

async function coverWithKeyboard(page: Page, coveredPx: number): Promise<void> {
  await page.evaluate((covered) => {
    (
      window as unknown as { __coverWithKeyboard(px: number): void }
    ).__coverWithKeyboard(covered);
  }, coveredPx);
}

type KeyboardLayout = {
  bandBottom: number;
  chromeBottom: number;
  composerBottom: number;
  logHeight: number;
  logDistanceFromBottom: number;
};

async function measureKeyboardLayout(page: Page): Promise<KeyboardLayout> {
  return page.evaluate(() => {
    const bottomOf = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el.getBoundingClientRect().bottom;
    };
    const log = document.querySelector('[role="log"]') as HTMLElement | null;
    if (!log) throw new Error("missing transcript log");
    return {
      bandBottom: window.visualViewport!.height,
      chromeBottom: bottomOf('[data-testid="open-thread-chrome"]'),
      composerBottom: bottomOf('[data-testid="conversation-composer"]'),
      logHeight: log.clientHeight,
      logDistanceFromBottom: log.scrollHeight - log.scrollTop - log.clientHeight,
    };
  });
}

test.describe("channel tabs", () => {
  // Use epic A so session-seeding tests on B/story cannot clear the empty state.
  test("switches to the channel tab and honors ?tab=", async ({
    page,
    seededApp,
  }) => {
    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-a`,
    );
    const main = page.getByRole("main");
    const tablist = main.getByRole("tablist", { name: "Issue detail" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(main.getByText("Epic A").first()).toBeVisible();

    await tablist.getByRole("tab", { name: "Implementing" }).click();
    await expect(page).toHaveURL(/[?&]tab=implementing(?:&|$)/);
    await expect(
      tablist.getByRole("tab", { name: "Implementing" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(main.getByText("No implementing session.")).toBeVisible();
    // Header stays put above the channel panel.
    await expect(main.getByText("Epic", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Epic A").first()).toBeVisible();

    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-a?tab=implementing`,
    );
    await expect(
      main.getByRole("tab", { name: "Implementing" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(main.getByText("No implementing session.")).toBeVisible();

    await main.getByRole("tab", { name: "Overview" }).click();
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expect(main.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Task detail offers Overview, Agents, and Diff", async ({
    page,
    seededApp,
  }) => {
    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-task-flight`,
    );
    const main = page.getByRole("main");
    await expect(main.getByText("Task", { exact: true }).first()).toBeVisible();
    const tablist = main.getByRole("tablist", { name: "Issue detail" });
    await expect(tablist.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Agents" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Diff" })).toBeVisible();
  });

  test("transcript scrolls inside the channel pane; composer stays visible", async ({
    page,
    seededApp,
  }) => {
    await seedChannelTranscript(
      page,
      seededApp.baseURL,
      "seed-epic-b",
      "implementing",
    );

    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-b?tab=implementing`,
    );
    const main = page.getByRole("main");
    const panel = main.getByTestId("channel-transcript-panel");
    await expect(panel).toBeVisible();
    const transcript = panel.getByRole("log", {
      name: "Conversation transcript",
    });
    await expect(transcript).toBeVisible();
    const composer = panel.getByTestId("conversation-composer");
    await expect(composer).toBeVisible();

    const before = await page.evaluate(() => {
      const log = document.querySelector(
        '[data-testid="channel-transcript-panel"] [role="log"]',
      ) as HTMLElement | null;
      return {
        logScrollHeight: log?.scrollHeight ?? 0,
        logClientHeight: log?.clientHeight ?? 0,
        logScrollTop: log?.scrollTop ?? 0,
        docScrollTop: document.documentElement.scrollTop,
      };
    });
    expect(before.logScrollHeight).toBeGreaterThan(before.logClientHeight);

    await transcript.evaluate((el) => {
      el.scrollTop = 0;
    });

    const after = await page.evaluate(() => {
      const log = document.querySelector(
        '[data-testid="channel-transcript-panel"] [role="log"]',
      ) as HTMLElement | null;
      return {
        logScrollTop: log?.scrollTop ?? -1,
        docScrollTop: document.documentElement.scrollTop,
        composerVisible: (() => {
          const c = document.querySelector(
            '[data-testid="conversation-composer"]',
          );
          if (!c) return false;
          const r = c.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        })(),
      };
    });
    expect(after.logScrollTop).toBe(0);
    expect(after.docScrollTop).toBe(0);
    expect(after.composerVisible).toBe(true);
    await expect(composer).toBeInViewport();
  });
});

test.describe("channel tabs at phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("tab bar stays reachable without horizontal page scroll", async ({
    page,
    seededApp,
  }) => {
    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-a`,
    );
    const main = page.getByRole("main");
    const tablist = main.getByRole("tablist", { name: "Issue detail" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(
      tablist.getByRole("tab", { name: "Implementing" }),
    ).toBeVisible();
    expect(await documentOverflowsHorizontally(page)).toBe(false);

    await tablist.getByRole("tab", { name: "Implementing" }).click();
    await expect(page).toHaveURL(/[?&]tab=implementing(?:&|$)/);
    expect(await documentOverflowsHorizontally(page)).toBe(false);
  });

  test("composer stays visible while the transcript scrolls on a phone", async ({
    page,
    seededApp,
  }) => {
    // Epic-child Stories offer no channel; use a sibling Epic.
    await seedChannelTranscript(
      page,
      seededApp.baseURL,
      "seed-epic-c",
      "implementing",
    );

    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-c?tab=implementing`,
    );
    const panel = page.getByTestId("channel-transcript-panel");
    const transcript = panel.getByRole("log", {
      name: "Conversation transcript",
    });
    const composer = panel.getByTestId("conversation-composer");
    await expect(composer).toBeVisible();
    await expect(composer).toBeInViewport();

    await transcript.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(composer).toBeInViewport();

    const scrolledDoc = await page.evaluate(
      () => document.documentElement.scrollTop,
    );
    expect(scrolledDoc).toBe(0);
  });

  test("the soft keyboard shortens the transcript instead of burying the composer", async ({
    page,
    seededApp,
  }) => {
    const KEYBOARD_PX = 320;
    await stubSoftKeyboard(page);
    await seedChannelTranscript(
      page,
      seededApp.baseURL,
      "seed-epic-d",
      "implementing",
    );

    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-d?tab=implementing`,
    );
    const panel = page.getByTestId("channel-transcript-panel");
    await expect(panel.getByTestId("conversation-composer")).toBeVisible();
    const before = await measureKeyboardLayout(page);
    expect(before.composerBottom).toBeLessThanOrEqual(before.bandBottom + 1);

    await coverWithKeyboard(page, KEYBOARD_PX);
    const after = await measureKeyboardLayout(page);

    // Send row above the keyboard, top compact chrome still in the band, and the
    // height came out of the transcript rather than the shell.
    expect(after.composerBottom).toBeLessThanOrEqual(after.bandBottom + 1);
    expect(after.chromeBottom).toBeLessThan(after.bandBottom);
    expect(after.logHeight).toBeLessThanOrEqual(before.logHeight - KEYBOARD_PX);
    expect(after.logHeight).toBeGreaterThan(0);
    // Latest messages stay in view after the transcript shortens.
    expect(after.logDistanceFromBottom).toBeLessThanOrEqual(1);
    expect(await documentOverflowsHorizontally(page)).toBe(false);
  });

  test("Overview still scrolls as a document on a phone", async ({
    page,
    seededApp,
  }) => {
    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-epic-b`,
    );
    const main = page.getByRole("main");
    await expect(
      main.getByRole("tab", { name: "Overview" }),
    ).toHaveAttribute("aria-selected", "true");

    // Make Overview tall enough to need document scroll.
    await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]:not([inert])');
      if (!panel) return;
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      spacer.dataset.testid = "overview-scroll-spacer";
      panel.appendChild(spacer);
    });

    const before = await page.evaluate(() => document.documentElement.scrollTop);
    await page.evaluate(() => {
      window.scrollTo(0, 800);
    });
    const after = await page.evaluate(() => document.documentElement.scrollTop);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(700);
  });
});
