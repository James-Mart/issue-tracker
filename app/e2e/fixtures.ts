import { test as base, expect } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessions } from "../server/services/agent-sessions.js";

// Deterministic seed tree with stable ids/titles so Flow/DAG assertions stay
// stable across runs: project `seed-proj`, epics A–D wired into a diamond
// (`seed-epic-d` blockedBy B and C; B and C blockedBy A), and under
// `seed-epic-b` a story in flight (one in-progress task) plus a merged story.
// Structure and Epic `blockedBy` are declared here; the task's `in-progress`
// status and the story's `merged` flag are runtime state, set after `apply`.
const seedDoc = {
  project: {
    id: "seed-proj",
    title: "Seed Project",
    children: [
      { kind: "epic", id: "seed-epic-a", title: "Epic A" },
      {
        kind: "epic",
        id: "seed-epic-b",
        title: "Epic B",
        blockedBy: ["seed-epic-a"],
        children: [
          {
            kind: "story",
            id: "seed-story-flight",
            title: "Story in flight",
            children: [
              { kind: "task", id: "seed-task-flight", title: "Task in flight" },
            ],
          },
          { kind: "story", id: "seed-story-merged", title: "Merged story" },
        ],
      },
      {
        kind: "epic",
        id: "seed-epic-c",
        title: "Epic C",
        blockedBy: ["seed-epic-a"],
      },
      {
        kind: "epic",
        id: "seed-epic-d",
        title: "Epic D",
        blockedBy: ["seed-epic-b", "seed-epic-c"],
      },
    ],
  },
};

export type SeededApp = {
  baseURL: string;
  stop: () => Promise<void>;
};

export type BootSeededAppOptions = {
  /** Override the default in-process agent sessions (e.g. a held fake SDK). */
  sessions?: AgentSessions;
};

// Seed a fresh `ISSUES_DIR` and boot the app/server against it in prod mode
// (Express serves the built client and the API from one origin). Env is set
// before the first server import so `config` reads the seeded dir / prod flag;
// modules are cached per worker, hence the worker scope.
export async function bootSeededApp(
  options: BootSeededAppOptions = {},
): Promise<SeededApp> {
  // Nest `issues/` under the temp root so `conversations/` (a sibling of
  // ISSUES_DIR) stays per-boot. A bare mkdtemp as ISSUES_DIR would share
  // `/tmp/conversations` across every seeded worker and leak channel sessions.
  const root = mkdtempSync(join(tmpdir(), "it-e2e-seed-"));
  const issuesDir = join(root, "issues");
  mkdirSync(issuesDir);
  process.env.ISSUES_DIR = issuesDir;
  process.env.NODE_ENV = "production";

  // Prod mode only serves the UI when the client is built. Fail fast with a
  // clear message instead of letting the spec time out on a blank page whose
  // API works but whose bundle never loads.
  const { hasBuiltClient } = await import("../server/config.js");
  if (!hasBuiltClient) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      "seeded e2e requires the built client; run `npm run build` before `npm run test:e2e`",
    );
  }

  const { parseApplyDoc } = await import("../server/services/apply-schema.js");
  const { apply } = await import("../server/services/apply.js");
  const { update } = await import("../server/services/issues.js");
  const { attachMultiplexedWebSocket, createApp } = await import(
    "../server/app.js"
  );

  const parsed = parseApplyDoc(seedDoc);
  if (!parsed.ok) throw new Error(`invalid seed doc: ${parsed.message}`);
  await apply(parsed.doc);
  await update("seed-task-flight", { status: "in-progress" });
  await update("seed-story-merged", { merged: true });

  const server: Server = await new Promise((resolve) => {
    const s = createApp(options.sessions).listen(0, "127.0.0.1", () =>
      resolve(s),
    );
  });
  attachMultiplexedWebSocket(server);
  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Specs import `{ test, expect }` from this file to get the deterministic tree.
export const test = base.extend<
  Record<string, never>,
  { seededApp: { baseURL: string } }
>({
  seededApp: [
    async ({}, use) => {
      const app = await bootSeededApp();
      await use({ baseURL: app.baseURL });
      await app.stop();
    },
    { scope: "worker" },
  ],
});

export { expect };
