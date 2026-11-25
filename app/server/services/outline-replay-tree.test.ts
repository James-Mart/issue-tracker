import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

/** A planning-scratch-shaped tree with one folder per direction. */
function writeScratch(scratch: string, directions: string[]): void {
  mkdirSync(scratch, { recursive: true });
  for (const directionId of directions) {
    mkdirSync(join(scratch, directionId, "parts"), { recursive: true });
    writeFileSync(
      join(scratch, directionId, `${directionId}.stories.tsx`),
      `export default { title: "${directionId}/Screen" };\nexport const Default = {};\n`,
    );
    writeFileSync(join(scratch, directionId, "parts", "fixture.ts"), `export const id = "${directionId}";\n`);
  }
  writeFileSync(join(scratch, "vite.mockup.ts"), "export default {};\n");
  writeFileSync(
    join(scratch, "harness.json"),
    JSON.stringify({
      targetRoot: root,
      cssEntries: [],
      aliases: { "@scratch": join(scratch, directions[0]!) },
      storiesGlobs: directions.map((directionId) => join(scratch, directionId, "**/*.stories.tsx")),
      viteConfigPath: join(scratch, "vite.mockup.ts"),
    }),
  );
  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "mockup-sandbox", private: true, dependencies: {} }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-outline-replay-"));
  issuesDir = join(root, "issues");
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
  writeIssue("i", {
    kind: "idea",
    title: "I",
    partOf: "p",
    order: 1,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it("restores an outline's bundles into its replay tree with harness paths rebased from the source tree", async () => {
  const { putAttachment } = await import("./attachments.js");
  const { create } = await import("./issues.js");
  const { packReplayBundle } = await import("./replay-bundle.js");
  const { restoreOutlineTree } = await import("./outline-replay-tree.js");
  const { replayTreeDir } = await import("./outline-mockup-store.js");
  const scratch = join(root, "scratch");
  writeScratch(scratch, ["a", "b"]);
  for (const directionId of ["a", "b"]) {
    await putAttachment("i", `mockup-${directionId}.tar.gz`, packReplayBundle(scratch, directionId));
  }
  const outline = await create({
    kind: "outline",
    title: "O",
    partOf: "p",
    description: "# O\n",
    sourceIdea: "i",
  });
  const tree = replayTreeDir(outline.id);
  mkdirSync(join(tree, "draft-c"), { recursive: true });
  writeFileSync(join(tree, "draft-c", "keep.txt"), "kept");

  expect(await restoreOutlineTree(outline.id)).toEqual({ directionIds: ["a", "b"] });

  const harness = JSON.parse(readFileSync(join(tree, "harness.json"), "utf8"));
  expect(harness.storiesGlobs).toEqual([
    join(tree, "a", "**/*.stories.tsx"),
    join(tree, "b", "**/*.stories.tsx"),
  ]);
  expect(harness.viteConfigPath).toBe(join(tree, "vite.mockup.ts"));
  expect(harness.aliases).toEqual({ "@scratch": join(tree, "a") });
  expect(harness.targetRoot).toBe(root);
  expect(JSON.stringify(harness)).not.toContain(scratch);
  expect(readFileSync(join(tree, "b", "parts", "fixture.ts"), "utf8")).toContain('"b"');
  expect(existsSync(join(tree, "vite.mockup.ts"))).toBe(true);
  expect(readFileSync(join(tree, "draft-c", "keep.txt"), "utf8")).toBe("kept");
  expect(existsSync(join(tree, "package-lock.json"))).toBe(true);
});
