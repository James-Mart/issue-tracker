#!/usr/bin/env -S npx tsx
/**
 * Capture Playwright screenshots of the running issue-tracker UI.
 *
 * Usage: npm run screenshots -- [options] <path-or-dialog>...
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { chromium, type Page } from "@playwright/test";

const DIALOGS = [
  "new-project",
  "rename-project",
  "new-epic",
  "new-story",
  "delete-issue",
  "restart-live-turns",
] as const;

type DialogId = (typeof DIALOGS)[number];
type Theme = "light" | "dark";
type ThemeMode = Theme | "both";
type IssueKind = "project" | "epic" | "idea" | "story" | "task";

type IssueRecord = {
  id: string;
  kind: IssueKind;
  partOf?: string | null;
  archived?: boolean;
  title?: string;
};

type Viewport = { width: number; height: number };

type Options = {
  baseUrl: string;
  out: string;
  project: string | null;
  theme: ThemeMode;
  viewport: Viewport;
  all: boolean;
  list: boolean;
  targets: string[];
};

const THEME_STORAGE_KEY = "ui-theme";
export const DEFAULT_BASE_URL = "http://localhost:8060";
const DEFAULT_OUT = "/tmp/issue-tracker-screenshots";

export function resolveDefaultBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.AGENT_STACK_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_BASE_URL;
}
const SETTLE_MS = 800;
const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 };

const SUPPORTING_DOC_TABS = [
  { label: "Vision", filename: "project-vision" },
  { label: "Coding standards", filename: "project-coding-standards" },
  { label: "Design system", filename: "project-design-system" },
] as const;

function usage(): string {
  return `Usage: npm run screenshots -- [options] <path-or-dialog>...

Capture screenshots of the running issue-tracker UI (server must already be up).

Pages: path targets starting with / (e.g. /, /projects/issue-tracker?lens=structure)
Dialogs: ${DIALOGS.join(", ")}

Options:
  --base-url <url>   Base URL (default AGENT_STACK_BASE_URL or ${DEFAULT_BASE_URL})
  --out <dir>        Output directory (default ${DEFAULT_OUT})
  --project <id>     Project for --all / dialog context (default: issue-tracker if present, else first project)
  --theme <mode>     light | dark | both (default dark)
  --viewport <WxH>   Browser viewport (default ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height})
  --all              Capture common paths for --project plus all dialogs
  --list             Print dialog names and exit
`;
}

function parseViewport(value: string): Viewport {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) {
    throw new Error(
      `--viewport must be <width>x<height> (e.g. 1440x900), got: ${JSON.stringify(value)}`,
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) {
    throw new Error(`--viewport width and height must be positive integers, got: ${value}`);
  }
  return { width, height };
}

function isDialog(target: string): target is DialogId {
  return (DIALOGS as readonly string[]).includes(target);
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    baseUrl: resolveDefaultBaseUrl(),
    out: DEFAULT_OUT,
    project: null,
    theme: "dark",
    viewport: DEFAULT_VIEWPORT,
    all: false,
    list: false,
    targets: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--base-url") {
      const value = argv[++i];
      if (!value) throw new Error("--base-url requires a value");
      opts.baseUrl = value.replace(/\/$/, "");
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out requires a value");
      opts.out = value;
    } else if (arg === "--project") {
      const value = argv[++i];
      if (!value) throw new Error("--project requires a value");
      opts.project = value;
    } else if (arg === "--theme") {
      const value = argv[++i];
      if (value !== "light" && value !== "dark" && value !== "both") {
        throw new Error("--theme must be light, dark, or both");
      }
      opts.theme = value;
    } else if (arg === "--viewport" || arg.startsWith("--viewport=")) {
      const value = arg.startsWith("--viewport=") ? arg.slice("--viewport=".length) : argv[++i];
      if (!value) throw new Error("--viewport requires a value");
      opts.viewport = parseViewport(value);
    } else if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--list") {
      opts.list = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      opts.targets.push(arg);
    }
  }

  return opts;
}

function pathFilename(path: string): string {
  const stripped = path.replace(/^\//, "");
  const stem = stripped.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "");
  return `${stem || "root"}.png`;
}

function dialogFilename(dialogId: DialogId): string {
  return `${dialogId}.png`;
}

function withThemeSuffix(filename: string, theme: Theme | null): string {
  if (!theme) return filename;
  return filename.replace(/\.png$/i, `-${theme}.png`);
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(
    ({ key, theme: next }) => {
      localStorage.setItem(key, next);
    },
    { key: THEME_STORAGE_KEY, theme },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expected) => document.documentElement.getAttribute("data-theme") === expected,
    theme,
  );
  await settle(page);
}

async function gotoPath(page: Page, baseUrl: string, path: string): Promise<void> {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(page);
}

const ISSUE_DETAIL_PATH = /^\/projects\/[^/]+\/issues\/[^/]+/;

/** Issue detail hydrates after theme reload; 800ms settle alone captures the skeleton. */
async function waitForIssueDetailReady(page: Page, path: string): Promise<void> {
  const pathname = path.split("?")[0] ?? path;
  if (!ISSUE_DETAIL_PATH.test(pathname)) return;

  await page.waitForFunction(
    () => {
      const body = document.body.textContent ?? "";
      if (body.includes("Loading issue")) return false;
      return (
        document.querySelector('[role="tablist"]') != null ||
        body.includes("Issue not found")
      );
    },
    { timeout: 20_000 },
  );

  const tab = new URL(path, "http://local").searchParams.get("tab");
  if (tab === "agents") {
    await page.waitForFunction(
      () => {
        const body = document.body.textContent ?? "";
        if (body.includes("Loading agent runs")) return false;
        return document.querySelector('[data-slot="agent-runs-panel"]') != null;
      },
      { timeout: 10_000 },
    );
  }

  await settle(page);
}

// Chromium needs its system shared libraries, not just its own build. Surface
// the remedy here instead of leaving a raw loader error from the browser.
async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    throw new Error(
      [
        err instanceof Error ? err.message : String(err),
        "",
        "Chromium could not start. Provision it with:",
        "  npx playwright install --with-deps chromium",
        "`npm install` runs that for you via its postinstall step.",
      ].join("\n"),
    );
  }
}

async function probeServer(baseUrl: string): Promise<IssueRecord[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/issues`);
  } catch (err) {
    throw new Error(
      [
        `App unreachable at ${baseUrl} (${err instanceof Error ? err.message : err}).`,
        "Serve it however you like — `npm run serve` (UI + API, no server reload),",
        "`npm run dev` (reloads the API on file changes), or `npx vite` for the UI plus",
        "`npm start` for the API. Vite proxies /api to the API port either way, so",
        `only ${baseUrl} has to answer. Use --base-url for any other arrangement`,
        "(e.g. a production server serving the built client on :8061).",
      ].join("\n"),
    );
  }
  if (!res.ok) {
    throw new Error(`GET ${baseUrl}/api/issues failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { issues?: IssueRecord[] };
  if (!Array.isArray(body.issues)) {
    throw new Error(`GET ${baseUrl}/api/issues: expected { issues: IssueRecord[] }`);
  }
  return body.issues;
}

function resolveProjectId(issues: IssueRecord[], requested: string | null): string {
  const projects = issues.filter((i) => i.kind === "project" && i.archived !== true);
  if (requested) {
    const found = projects.find((p) => p.id === requested);
    if (!found) throw new Error(`Project not found: ${requested}`);
    return found.id;
  }
  if (projects.some((p) => p.id === "issue-tracker")) return "issue-tracker";
  if (projects[0]) return projects[0].id;
  throw new Error("No projects found in GET /api/issues");
}

function storyUnderProject(
  story: IssueRecord,
  projectId: string,
  byId: Map<string, IssueRecord>,
): boolean {
  if (story.kind !== "story" || story.archived === true) return false;
  if (story.partOf === projectId) return true;
  const parent = story.partOf ? byId.get(story.partOf) : undefined;
  return Boolean(parent && parent.kind === "epic" && parent.partOf === projectId && parent.archived !== true);
}

function samplesForProject(issues: IssueRecord[], projectId: string) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const active = (i: IssueRecord) => i.archived !== true;

  const epic = issues.find((i) => i.kind === "epic" && active(i) && i.partOf === projectId);
  const idea = issues.find((i) => i.kind === "idea" && active(i) && i.partOf === projectId);
  const story = issues.find((i) => i.kind === "story" && active(i) && i.partOf === projectId);
  const task = issues.find((i) => {
    if (i.kind !== "task" || !active(i) || !i.partOf) return false;
    const parent = byId.get(i.partOf);
    return Boolean(parent && storyUnderProject(parent, projectId, byId));
  });

  return { epic, idea, story, task };
}

function expandAll(projectId: string, samples: ReturnType<typeof samplesForProject>): string[] {
  const paths = [
    "/",
    `/projects/${projectId}`,
    `/projects/${projectId}?lens=structure`,
    `/projects/${projectId}/issues/${projectId}`,
  ];

  for (const kind of ["epic", "idea", "story", "task"] as const) {
    const sample = samples[kind];
    if (sample) {
      paths.push(`/projects/${projectId}/issues/${sample.id}`);
    } else {
      console.warn(`warn: no ${kind} sample under project ${projectId}; skipping detail shot`);
    }
  }

  return [...paths, ...DIALOGS];
}

async function writeScreenshot(
  page: Page,
  outDir: string,
  filename: string,
): Promise<string> {
  const outPath = resolve(outDir, filename);
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  writeFileSync(outPath, buffer);
  console.log(outPath);
  return outPath;
}

async function openNewProjectDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByTestId("project-dialog").waitFor({ state: "visible" });
}

async function openRenameProjectDialog(page: Page, projectId: string): Promise<void> {
  const item = page.getByRole("listitem").filter({
    has: page.locator(`a[href="/projects/${projectId}"]`),
  });
  await item.hover();
  await item.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("project-dialog").waitFor({ state: "visible" });
}

async function openNewEpicDialog(page: Page): Promise<void> {
  await page.getByRole("main").getByRole("button", { name: "New" }).click();
  await page.getByRole("menuitem", { name: "New epic" }).click();
  await page.getByTestId("new-issue-dialog").waitFor({ state: "visible" });
}

async function openNewStoryDialog(page: Page): Promise<void> {
  await page.getByRole("main").getByRole("button", { name: "New" }).click();
  await page.getByRole("menuitem", { name: "New story" }).click();
  await page.getByTestId("new-issue-dialog").waitFor({ state: "visible" });
}

function dialogPrepPath(projectId: string, dialogId: DialogId): string {
  switch (dialogId) {
    case "new-project":
      return "/";
    case "rename-project":
      return `/projects/${projectId}`;
    case "new-epic":
    case "new-story":
    case "delete-issue":
      return `/projects/${projectId}?lens=structure`;
    case "restart-live-turns":
      return `/projects/${projectId}`;
  }
}

async function openDialog(
  page: Page,
  projectId: string,
  dialogId: DialogId,
  samples: ReturnType<typeof samplesForProject>,
): Promise<void> {
  switch (dialogId) {
    case "new-project":
      await openNewProjectDialog(page);
      break;
    case "rename-project":
      await openRenameProjectDialog(page, projectId);
      break;
    case "new-epic":
      await openNewEpicDialog(page);
      break;
    case "new-story":
      await openNewStoryDialog(page);
      break;
    case "delete-issue": {
      const target = samples.epic ?? samples.story;
      if (!target) {
        throw new Error(`no epic or story under project ${projectId} for delete-issue`);
      }
      const row = page.locator(".group", {
        has: page.locator(`a[href*="/issues/${target.id}"]`),
      });
      await row.hover();
      await row.getByTitle("Delete").click();
      await page.getByTestId("delete-issue-dialog").waitFor({ state: "visible" });
      break;
    }
    case "restart-live-turns": {
      await page.route("**/api/health", async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: JSON.stringify({ ...json, restartSupported: true }),
        });
      });
      await page.route("**/api/restart", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "runs-in-flight",
            activeRuns: [{ conversationId: "conv-live-turn" }],
          }),
        });
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("restart-control").click();
      await page
        .getByTestId("restart-live-turns-dialog")
        .waitFor({ state: "visible" });
      break;
    }
  }
}

async function captureSupportingDocTabs(
  page: Page,
  outDir: string,
  themeSuffix: Theme | null,
): Promise<number> {
  let count = 0;
  for (const tab of SUPPORTING_DOC_TABS) {
    const locator = page.getByRole("tab", { name: tab.label, exact: true });
    if ((await locator.count()) === 0) continue;
    await locator.click();
    await settle(page);
    await writeScreenshot(page, outDir, withThemeSuffix(`${tab.filename}.png`, themeSuffix));
    count++;
  }
  return count;
}

async function captureTarget(
  page: Page,
  opts: {
    baseUrl: string;
    outDir: string;
    projectId: string;
    target: string;
    theme: Theme;
    themeSuffix: Theme | null;
    samples: ReturnType<typeof samplesForProject>;
    captureProjectDocTabs: boolean;
  },
): Promise<number> {
  const { baseUrl, outDir, projectId, target, theme, themeSuffix, samples, captureProjectDocTabs } =
    opts;

  if (isDialog(target)) {
    // Theme reload closes dialogs — land on prep page, apply theme, then open.
    await gotoPath(page, baseUrl, dialogPrepPath(projectId, target));
    await applyTheme(page, theme);
    await openDialog(page, projectId, target, samples);
    await settle(page);
    await writeScreenshot(page, outDir, withThemeSuffix(dialogFilename(target), themeSuffix));
    return 1;
  }

  if (!target.startsWith("/")) {
    throw new Error(`Unknown target (not a path or dialog): ${target}`);
  }

  await gotoPath(page, baseUrl, target);
  await applyTheme(page, theme);
  await waitForIssueDetailReady(page, target);
  await writeScreenshot(page, outDir, withThemeSuffix(pathFilename(target), themeSuffix));
  let count = 1;

  if (
    captureProjectDocTabs &&
    target === `/projects/${projectId}/issues/${projectId}`
  ) {
    count += await captureSupportingDocTabs(page, outDir, themeSuffix);
  }

  return count;
}

async function main(): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error(usage());
    process.exit(1);
  }

  if (opts.list) {
    for (const name of DIALOGS) console.log(name);
    return;
  }

  if (!opts.all && opts.targets.length === 0) {
    console.error("Error: provide at least one path/dialog target, or --all / --list.");
    console.error(usage());
    process.exit(1);
  }

  for (const target of opts.targets) {
    if (!target.startsWith("/") && !isDialog(target)) {
      console.error(`Unknown target (not a path or dialog): ${target}`);
      console.error(usage());
      process.exit(1);
    }
  }

  const issues = await probeServer(opts.baseUrl);
  const projectId = resolveProjectId(issues, opts.project);
  const samples = samplesForProject(issues, projectId);

  const targets: string[] = [];
  if (opts.all) targets.push(...expandAll(projectId, samples));
  for (const t of opts.targets) {
    if (!targets.includes(t)) targets.push(t);
  }

  mkdirSync(opts.out, { recursive: true });

  const themes: Theme[] = opts.theme === "both" ? ["dark", "light"] : [opts.theme];
  const themeSuffix = opts.theme === "both";

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: opts.viewport });

  let succeeded = 0;
  try {
    for (const target of targets) {
      for (const theme of themes) {
        try {
          succeeded += await captureTarget(page, {
            baseUrl: opts.baseUrl,
            outDir: opts.out,
            projectId,
            target,
            theme,
            themeSuffix: themeSuffix ? theme : null,
            samples,
            captureProjectDocTabs: opts.all,
          });
        } catch (err) {
          console.warn(
            `warn: failed ${target} (${theme}): ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (succeeded < 1) {
    console.error("Error: no screenshots captured.");
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
