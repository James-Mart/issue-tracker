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
import type { ApplyDoc } from "./apply-schema.js";
import {
  MAX_ATTACHMENT_BYTES,
  uniqueAttachmentBasename,
} from "./attachments.js";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-attachments-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
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

async function loadAttachments() {
  return import("./attachments.js");
}

async function loadIssues() {
  return import("./issues.js");
}

async function loadApply() {
  return import("./apply.js");
}

describe("listAttachments / putAttachment / getAttachment / removeAttachment", () => {
  it("stores, lists metadata, reads bytes, and removes", async () => {
    const { listAttachments, putAttachment, getAttachment, removeAttachment } =
      await loadAttachments();

    expect(listAttachments("c")).toEqual([]);

    const v1 = Buffer.from("export const x = 1;\n");
    const first = await putAttachment("c", "mock.tsx", v1);
    expect(first.name).toBe("mock.tsx");
    expect(first.size).toBe(v1.byteLength);
    expect(first.mime).toBe("application/octet-stream");
    expect(Number.isNaN(Date.parse(first.mtime))).toBe(false);
    expect(readFileSync(join(dir, "c", "attachments", "mock.tsx"), "utf8")).toBe(
      "export const x = 1;\n",
    );

    const got = await getAttachment("c", "mock.tsx");
    expect(got.meta.name).toBe("mock.tsx");
    expect(got.bytes.equals(v1)).toBe(true);

    const listed = listAttachments("c");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("mock.tsx");

    await putAttachment("c", "shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const two = listAttachments("c").map((a) => a.name);
    expect(two).toEqual(["mock.tsx", "shot.png"]);
    expect(listAttachments("c").find((a) => a.name === "shot.png")?.mime).toBe(
      "image/png",
    );

    await removeAttachment("c", "mock.tsx");
    expect(listAttachments("c").map((a) => a.name)).toEqual(["shot.png"]);
    expect(existsSync(join(dir, "c", "attachments", "mock.tsx"))).toBe(false);
  });

  it("keeps the first file and stores a collision under a unique name", async () => {
    const { listAttachments, putAttachment } = await loadAttachments();

    const first = await putAttachment("c", "foo.tsx", Buffer.from("v1"));
    expect(first.name).toBe("foo.tsx");

    const second = await putAttachment("c", "foo.tsx", Buffer.from("v2"));
    expect(second.name).toBe("foo-2.tsx");
    expect(readFileSync(join(dir, "c", "attachments", "foo.tsx"), "utf8")).toBe(
      "v1",
    );
    expect(
      readFileSync(join(dir, "c", "attachments", "foo-2.tsx"), "utf8"),
    ).toBe("v2");
    expect(listAttachments("c").map((a) => a.name)).toEqual([
      "foo-2.tsx",
      "foo.tsx",
    ]);
  });
});

describe("uniqueAttachmentBasename", () => {
  it("keeps the requested name when free", () => {
    expect(uniqueAttachmentBasename("foo.tsx", [])).toBe("foo.tsx");
  });

  it("uses stem + last ext for collisions", () => {
    expect(uniqueAttachmentBasename("foo.tsx", ["foo.tsx"])).toBe("foo-2.tsx");
    expect(
      uniqueAttachmentBasename("foo.bar.tsx", ["foo.bar.tsx"]),
    ).toBe("foo.bar-2.tsx");
  });

  it("handles names with no extension", () => {
    expect(uniqueAttachmentBasename("README", ["README"])).toBe("README-2");
  });

  it("treats a trailing -N in the request as literal stem", () => {
    expect(uniqueAttachmentBasename("foo-2.tsx", ["foo-2.tsx"])).toBe(
      "foo-2-2.tsx",
    );
  });

  it("fills gaps with the smallest free n ≥ 2", () => {
    expect(
      uniqueAttachmentBasename("foo.tsx", [
        "foo.tsx",
        "foo-2.tsx",
        "foo-4.tsx",
      ]),
    ).toBe("foo-3.tsx");
  });
});

describe("listAttachments / putAttachment / getAttachment / removeAttachment (guards)", () => {
  it("allows attachments on epic, story, and idea", async () => {
    writeIssue("idea-1", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { putAttachment, listAttachments } = await loadAttachments();
    await putAttachment("e", "a.txt", Buffer.from("epic"));
    await putAttachment("b", "b.txt", Buffer.from("branch"));
    await putAttachment("idea-1", "note.txt", Buffer.from("idea"));
    expect(listAttachments("e").map((a) => a.name)).toEqual(["a.txt"]);
    expect(listAttachments("b").map((a) => a.name)).toEqual(["b.txt"]);
    expect(listAttachments("idea-1").map((a) => a.name)).toEqual(["note.txt"]);
  });

  it("stores and lists attachments on a project", async () => {
    const { listAttachments, putAttachment, getAttachment, removeAttachment } =
      await loadAttachments();

    await putAttachment("p", "vision.md", Buffer.from("# Vision"));
    expect(listAttachments("p").map((a) => a.name)).toEqual(["vision.md"]);
    const got = await getAttachment("p", "vision.md");
    expect(got.bytes.toString("utf8")).toBe("# Vision");
    await removeAttachment("p", "vision.md");
    expect(listAttachments("p")).toEqual([]);
  });

  it("refuses unknown ids", async () => {
    const { listAttachments, putAttachment, getAttachment, removeAttachment } =
      await loadAttachments();

    expect(() => listAttachments("ghost")).toThrow(/unknown issue/);
    await expect(
      putAttachment("ghost", "x.txt", Buffer.from("nope")),
    ).rejects.toThrow(/unknown issue/);
    await expect(getAttachment("ghost", "x.txt")).rejects.toThrow(
      /unknown issue/,
    );
  });

  it("refuses oversize payloads", async () => {
    const { putAttachment } = await loadAttachments();
    const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    await expect(putAttachment("c", "big.bin", bytes)).rejects.toThrow(
      /limit/i,
    );
  });

  it("refuses unsafe basenames", async () => {
    const { putAttachment, getAttachment, removeAttachment } =
      await loadAttachments();
    const bytes = Buffer.from("x");
    for (const name of ["", "..", ".", "a/b", "a\\b", "a\0b", "../x"]) {
      await expect(putAttachment("c", name, bytes)).rejects.toThrow(/unsafe/i);
      await expect(getAttachment("c", name)).rejects.toThrow(/unsafe/i);
      await expect(removeAttachment("c", name)).rejects.toThrow(/unsafe/i);
    }
  });

  it("throws when reading or removing a missing attachment", async () => {
    const { getAttachment, removeAttachment } = await loadAttachments();
    await expect(getAttachment("c", "missing.txt")).rejects.toThrow(
      /not found/,
    );
    await expect(removeAttachment("c", "missing.txt")).rejects.toThrow(
      /not found/,
    );
  });
});

describe("deletion cascade removes attachments", () => {
  it("removes the whole issue directory including attachments", async () => {
    const { putAttachment } = await loadAttachments();
    const { remove } = await loadIssues();
    await putAttachment("c", "keep-me.bin", Buffer.from("bytes"));
    expect(existsSync(join(dir, "c", "attachments", "keep-me.bin"))).toBe(true);

    await remove("c");
    expect(existsSync(join(dir, "c"))).toBe(false);
  });
});

describe("apply leaves attachment bytes untouched", () => {
  it("rewriting a description does not change attachments", async () => {
    const { putAttachment } = await loadAttachments();
    const { apply } = await loadApply();

    const payload = Buffer.from("canvas-bytes-v1");
    await putAttachment("c", "ui.tsx", payload);
    writeFileSync(join(dir, "c", "description.md"), "original\n");

    const doc: ApplyDoc = {
      project: {
        id: "p",
        title: "P",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: [
                  {
                    kind: "task",
                    id: "c",
                    title: "C",
                    description: "rewritten by apply\n",
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const summary = await apply(doc);
    expect(summary.updated).toContain("c");
    expect(readFileSync(join(dir, "c", "description.md"), "utf8")).toBe(
      "rewritten by apply\n",
    );
    expect(readFileSync(join(dir, "c", "attachments", "ui.tsx"))).toEqual(
      payload,
    );
  });
});
