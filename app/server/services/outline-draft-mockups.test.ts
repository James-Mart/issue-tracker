import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeReplayScratch, writeStoredIssue } from "./outline-replay-fixtures.js";

const captures = vi.hoisted(() => ({
  captureOutlineDirections: vi.fn(),
}));

vi.mock("./outline-captures.js", () => captures);

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  writeStoredIssue(issuesDir, id, body);
}

function writeScratch(scratch: string, directions: string[]): void {
  writeReplayScratch(root, scratch, directions);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-outline-draft-mockups-"));
  issuesDir = join(root, "issues");
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  captures.captureOutlineDirections.mockReset();
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function seedPackedDraft(): Promise<{ outlineId: string; tree: string }> {
  const { putAttachment } = await import("./attachments.js");
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
  const tree = replayTreeDir(outline.id);
  writeScratch(tree, ["a", "c"]);
  await putAttachment(outline.id, "mockup-a.tar.gz", Buffer.from("old-a"));
  await putAttachment(outline.id, "mockup-c.tar.gz", Buffer.from("idea-c"));
  await setOutlineDraft(outline.id, "draft\n");
  await packOutlineTree(outline.id);
  return { outlineId: outline.id, tree };
}

it("publishing keeps rewritten bundles, drops backups, and stores held captures", async () => {
  const { getAttachment, listAttachments } = await import("./attachments.js");
  const { saveOutlineDraftVersion } = await import("./outline-draft.js");
  const { readOutlineDraft } = await import("./outline-draft-store.js");
  const { liveReplayDirectionIds } = await import("./outline-attachments.js");
  const { outlineCapturesDir } = await import("./outline-mockup-store.js");
  const { outlineId } = await seedPackedDraft();
  const packedA = (await getAttachment(outlineId, "mockup-a.tar.gz")).bytes;
  captures.captureOutlineDirections.mockImplementation(async (id: string) => {
    const dir = outlineCapturesDir(id);
    mkdirSync(dir, { recursive: true });
    const phone = join(dir, "mockup-a-screen-phone.png");
    const desktop = join(dir, "mockup-c-screen-desktop.png");
    writeFileSync(phone, Buffer.from("phone"));
    writeFileSync(desktop, Buffer.from("desktop"));
    return [
      { directionId: "a", stateSlug: "screen", viewport: "phone", pngPath: phone },
      { directionId: "c", stateSlug: "screen", viewport: "desktop", pngPath: desktop },
    ];
  });

  await saveOutlineDraftVersion(outlineId);

  expect(captures.captureOutlineDirections).toHaveBeenCalledWith(outlineId, { fromPack: true });
  const names = listAttachments(outlineId).map((attachment) => attachment.name);
  expect((await getAttachment(outlineId, "mockup-a.tar.gz")).bytes).toEqual(packedA);
  expect(names).toContain("mockup-c.tar.gz");
  expect(names).not.toContain("mockup-a.backup.tar.gz");
  expect((await getAttachment(outlineId, "mockup-a-screen-phone.png")).bytes).toEqual(
    Buffer.from("phone"),
  );
  expect((await getAttachment(outlineId, "mockup-c-screen-desktop.png")).bytes).toEqual(
    Buffer.from("desktop"),
  );
  expect(liveReplayDirectionIds(outlineId).sort()).toEqual(["a", "c"]);
  expect(readOutlineDraft(outlineId)).toBeUndefined();
});
