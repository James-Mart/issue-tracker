import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function draft(title: string, body = "body"): string {
  return `---\ntitle: ${title}\n---\n${body}\n`;
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function draftPath(name: string): string {
  return join(dir, "c", "attachments", name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-export-drafts-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("c", {
    kind: "task",
    title: "C",
    partOf: "b",
    order: 0,
    status: "todo",
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("./export-drafts.js");
}

async function loadAttachments() {
  return import("./attachments.js");
}

describe("replaceExportDrafts", () => {
  it("replaces the reserved set and leaves other attachments", async () => {
    const { replaceExportDrafts } = await load();
    const { putAttachment, listAttachments } = await loadAttachments();
    await putAttachment("c", "notes.md", Buffer.from("stay"));
    await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep", "old") },
      { name: "github-export-drop.md", content: draft("Drop", "gone") },
    ]);

    const replaced = await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep", "new") },
      { name: "github-export-next.md", content: draft("Next", "fresh") },
    ]);

    expect(replaced.map((item) => item.name)).toEqual([
      "github-export-keep.md",
      "github-export-next.md",
    ]);
    expect(replaced.every((item) => item.size > 0 && item.mime)).toBe(true);
    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "new"),
    );
    expect(existsSync(draftPath("github-export-drop.md"))).toBe(false);
    expect(readFileSync(draftPath("notes.md"), "utf8")).toBe("stay");
    expect(listAttachments("c").map((item) => item.name)).toEqual([
      "github-export-keep.md",
      "github-export-next.md",
      "notes.md",
    ]);
  });

  it("clears the reserved set when files is empty", async () => {
    const { replaceExportDrafts } = await load();
    const { putAttachment, listAttachments } = await loadAttachments();
    await putAttachment("c", "notes.md", Buffer.from("stay"));
    await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep") },
    ]);

    expect(await replaceExportDrafts("c", [])).toEqual([]);
    expect(existsSync(draftPath("github-export-keep.md"))).toBe(false);
    expect(listAttachments("c").map((item) => item.name)).toEqual(["notes.md"]);
  });

  it("rolls back the previous set when a write fails", async () => {
    const { replaceExportDrafts } = await load();
    await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep", "old") },
      { name: "github-export-drop.md", content: draft("Drop", "gone") },
    ]);
    mkdirSync(draftPath("github-export-new.md"));

    await expect(
      replaceExportDrafts("c", [
        { name: "github-export-keep.md", content: draft("Keep", "new") },
        { name: "github-export-new.md", content: draft("New", "nope") },
      ]),
    ).rejects.toMatchObject({ code: "EISDIR" });

    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "old"),
    );
    expect(readFileSync(draftPath("github-export-drop.md"), "utf8")).toBe(
      draft("Drop", "gone"),
    );
    expect(existsSync(draftPath("github-export-new.md"))).toBe(true);
  });

  it("refuses a bad name without changing the previous set", async () => {
    const { replaceExportDrafts } = await load();
    await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep", "old") },
    ]);

    await expect(
      replaceExportDrafts("c", [
        { name: "github-export-keep.md", content: draft("Keep", "new") },
        { name: "notes.md", content: draft("Notes") },
      ]),
    ).rejects.toThrow(/not a github-export draft/);

    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "old"),
    );
    expect(existsSync(draftPath("notes.md"))).toBe(false);
  });

  it("refuses a missing title without changing the previous set", async () => {
    const { replaceExportDrafts } = await load();
    await replaceExportDrafts("c", [
      { name: "github-export-keep.md", content: draft("Keep", "old") },
    ]);

    await expect(
      replaceExportDrafts("c", [
        {
          name: "github-export-keep.md",
          content: "---\ntitle: Keep\n---\nstill old?\n",
        },
        { name: "github-export-next.md", content: "# no frontmatter\n" },
      ]),
    ).rejects.toThrow(/missing title/);

    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "old"),
    );
    expect(existsSync(draftPath("github-export-next.md"))).toBe(false);
  });

  it("refuses a non-string title", async () => {
    const { replaceExportDrafts } = await load();
    await expect(
      replaceExportDrafts("c", [
        { name: "github-export-n.md", content: "---\ntitle: 1\n---\nbody\n" },
      ]),
    ).rejects.toThrow(/missing title/);
    expect(existsSync(draftPath("github-export-n.md"))).toBe(false);
  });
});

describe("overwriteExportDraft", () => {
  it("overwrites a reserved name in place", async () => {
    const { overwriteExportDraft } = await load();
    const { listAttachments } = await loadAttachments();

    const created = await overwriteExportDraft(
      "c",
      "github-export-keep.md",
      draft("Keep", "v1"),
    );
    expect(created.name).toBe("github-export-keep.md");

    const updated = await overwriteExportDraft(
      "c",
      "github-export-keep.md",
      draft("Keep", "v2"),
    );
    expect(updated.name).toBe("github-export-keep.md");
    expect(updated.size).toBe(Buffer.byteLength(draft("Keep", "v2")));
    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "v2"),
    );
    expect(listAttachments("c").map((item) => item.name)).toEqual([
      "github-export-keep.md",
    ]);
  });

  it("refuses overwrite of a non-reserved name", async () => {
    const { overwriteExportDraft } = await load();
    const { putAttachment } = await loadAttachments();
    await putAttachment("c", "notes.md", Buffer.from("v1"));

    await expect(
      overwriteExportDraft("c", "notes.md", draft("Notes", "v2")),
    ).rejects.toThrow(/not a github-export draft/);
    expect(readFileSync(draftPath("notes.md"), "utf8")).toBe("v1");
  });

  it("refuses a reserved overwrite that is missing title", async () => {
    const { overwriteExportDraft } = await load();
    await overwriteExportDraft("c", "github-export-keep.md", draft("Keep", "old"));

    await expect(
      overwriteExportDraft("c", "github-export-keep.md", "# bare\n"),
    ).rejects.toThrow(/missing title/);
    expect(readFileSync(draftPath("github-export-keep.md"), "utf8")).toBe(
      draft("Keep", "old"),
    );
  });
});
