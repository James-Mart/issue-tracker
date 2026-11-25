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
  const targetSrc = join(root, "target-src");
  mkdirSync(targetSrc, { recursive: true });
  writeFileSync(join(scratch, "vite.mockup.ts"), "export default {};\n");
  writeFileSync(
    join(scratch, "harness.json"),
    JSON.stringify({
      targetRoot: root,
      cssEntries: [],
      aliases: { "@scratch": targetSrc },
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
  expect(harness.aliases).toEqual({ "@scratch": join(root, "target-src") });
  expect(harness.targetRoot).toBe(root);
  expect(JSON.stringify(harness)).not.toContain(scratch);
  expect(readFileSync(join(tree, "b", "parts", "fixture.ts"), "utf8")).toContain('"b"');
  expect(existsSync(join(tree, "vite.mockup.ts"))).toBe(true);
  expect(readFileSync(join(tree, "draft-c", "keep.txt"), "utf8")).toBe("kept");
  expect(existsSync(join(tree, "package-lock.json"))).toBe(true);
});

it("drops one direction's bundle and stories and leaves the shared tree and the other direction", async () => {
  const { listAttachments, putAttachment } = await import("./attachments.js");
  const { create } = await import("./issues.js");
  const { authorWorkspace, dropOutlineDirection } = await import("./outline-replay-tree.js");
  const { outlineMockupsRoot, replayTreeDir, writeAuthorRunState } = await import(
    "./outline-mockup-store.js"
  );
  mkdirSync(join(root, "conversations", "conv"), { recursive: true });
  writeFileSync(join(root, "conversations", "conv", "meta.json"), "{}\n");
  const outline = await create({
    kind: "outline",
    title: "O",
    partOf: "p",
    description: "# O\n",
    sourceIdea: "i",
  });
  const tree = replayTreeDir(outline.id);
  writeScratch(tree, ["a", "b"]);
  mkdirSync(join(tree, "node_modules"), { recursive: true });
  writeFileSync(join(tree, "node_modules", "keep.txt"), "installed");
  const harness = readFileSync(join(tree, "harness.json"), "utf8");
  const manifest = readFileSync(join(tree, "package.json"), "utf8");
  mkdirSync(join(outlineMockupsRoot(outline.id), "storybook"), { recursive: true });
  writeFileSync(join(outlineMockupsRoot(outline.id), "storybook", "marker.txt"), "live");
  writeAuthorRunState(outline.id, "running");
  await putAttachment(outline.id, "mockup-a.tar.gz", Buffer.from("bundle-a"));
  await putAttachment(outline.id, "mockup-b.tar.gz", Buffer.from("bundle-b"));
  await putAttachment(outline.id, "mockup-a.backup.tar.gz", Buffer.from("backup-a"));

  await dropOutlineDirection(outline.id, "a");

  const names = listAttachments(outline.id).map((attachment) => attachment.name);
  expect(names).not.toContain("mockup-a.tar.gz");
  expect(names).toEqual(["mockup-a.backup.tar.gz", "mockup-b.tar.gz"]);
  expect(existsSync(join(tree, "a"))).toBe(false);
  expect(readFileSync(join(tree, "b", "parts", "fixture.ts"), "utf8")).toContain('"b"');
  expect(readFileSync(join(tree, "harness.json"), "utf8")).toBe(harness);
  expect(readFileSync(join(tree, "package.json"), "utf8")).toBe(manifest);
  expect(readFileSync(join(tree, "node_modules", "keep.txt"), "utf8")).toBe("installed");
  expect(readFileSync(join(outlineMockupsRoot(outline.id), "storybook", "marker.txt"), "utf8")).toBe(
    "live",
  );
  expect(authorWorkspace(outline.id, "conv")).toBe(tree);
});

it("keeps an unpublished draft's overwritten bundles reversible", async () => {
  const { getAttachment, listAttachments, putAttachment } = await import("./attachments.js");
  const { create } = await import("./issues.js");
  const { setOutlineDraft } = await import("./outline-draft.js");
  const { packOutlineTree } = await import("./outline-replay-tree.js");
  const { replayTreeDir } = await import("./outline-mockup-store.js");
  const outline = await create({
    kind: "outline",
    title: "Spec",
    partOf: "p",
    description: "# Spec\n",
  });
  writeIssue("story", {
    kind: "story",
    title: "Story",
    partOf: "p",
    sourceOutline: { outline: outline.id, version: 1 },
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("append", {
    kind: "idea",
    title: "Append",
    partOf: "p",
    appendTo: "story",
    archived: false,
    order: 3,
    createdAt: AT,
    updatedAt: AT,
  });
  const tree = replayTreeDir(outline.id);
  writeScratch(tree, ["a", "c"]);
  await putAttachment(outline.id, "mockup-a.tar.gz", Buffer.from("old-a"));
  await putAttachment("append", "mockup-c.tar.gz", Buffer.from("idea-c"));

  await setOutlineDraft(outline.id, "draft\n");

  const bytes = async (id: string, name: string) => (await getAttachment(id, name)).bytes;
  expect(await bytes(outline.id, "mockup-c.tar.gz")).toEqual(Buffer.from("idea-c"));
  expect(listAttachments("append").map((attachment) => attachment.name)).toEqual([]);

  expect(await packOutlineTree(outline.id)).toEqual({ directionIds: ["a", "c"] });
  expect(await bytes(outline.id, "mockup-a.backup.tar.gz")).toEqual(Buffer.from("old-a"));
  expect(listAttachments(outline.id).map((attachment) => attachment.name)).not.toContain(
    "mockup-c.backup.tar.gz",
  );

  writeFileSync(
    join(tree, "a", "a.stories.tsx"),
    `export default { title: "a/Screen" };\nexport const Changed = {};\n`,
  );
  await packOutlineTree(outline.id);

  expect(await bytes(outline.id, "mockup-a.backup.tar.gz")).toEqual(Buffer.from("old-a"));
  expect(listAttachments(outline.id).map((attachment) => attachment.name)).not.toContain(
    "mockup-c.backup.tar.gz",
  );
});
