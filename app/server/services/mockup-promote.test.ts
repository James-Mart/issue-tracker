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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachments.js";
import type { CaptureResult } from "./mockup-story-capture.js";

const AT = "2026-07-09T14:00:00.000Z";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function seedIssues(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("src", {
    kind: "idea",
    title: "Source",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("dst", {
    kind: "idea",
    title: "Dest",
    partOf: "p",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function loadPromote() {
  return import("./mockup-promote.js");
}

async function loadScratch() {
  return import("./mockup-scratch.js");
}

async function loadAttachments() {
  return import("./attachments.js");
}

function writePng(path: string, marker: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.from(`png:${marker}`));
}

function capture(
  storyId: string,
  viewport: "phone" | "desktop",
  absolutePath: string,
): CaptureResult {
  return { storyId, viewport, absolutePath };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-promote-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedIssues();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("attachment names", () => {
  it("uses slugified story ids in candidate and chosen names", async () => {
    const {
      candidateAttachmentName,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();

    expect(candidateAttachmentName("direction-a", "direction-a-card--default")).toBe(
      "mockup-candidate-direction-a-direction-a-card-default-phone.png",
    );
    expect(
      chosenAttachmentName("direction-a", "direction-a-card--default", "desktop"),
    ).toBe("mockup-direction-a-direction-a-card-default-desktop.png");
    expect(chosenArchiveName("direction-a")).toBe("mockup-direction-a.tar.gz");
  });
});

describe("createDirectionArchive", () => {
  it("packs story files and harness.json", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const { createDirectionArchive, chosenArchiveName } = await loadPromote();

    const storiesDir = directionDir("promote-chat", "direction-a");
    mkdirSync(join(storiesDir, "nested"), { recursive: true });
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    writeFileSync(
      join(storiesDir, "nested", "Header.stories.tsx"),
      "export const Hover = {};",
    );
    writeFileSync(join(storiesDir, "shot-phone.png"), "not a story");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ storiesGlobs: [] }));

    const archivePath = createDirectionArchive("promote-chat", "direction-a");
    expect(existsSync(archivePath)).toBe(true);
    expect(archivePath.endsWith(chosenArchiveName("direction-a"))).toBe(true);

    const extractDir = mkdtempSync(join(tmpdir(), "mockup-promote-extract-"));
    try {
      const { spawnSync } = await import("node:child_process");
      const extracted = spawnSync(
        "tar",
        ["-tzf", archivePath],
        { encoding: "utf8" },
      );
      expect(extracted.status).toBe(0);
      const entries = extracted.stdout
        .split("\n")
        .map((line) => line.replace(/\/$/, ""))
        .filter(Boolean)
        .sort();
      expect(entries).toEqual([
        "Card.stories.tsx",
        "harness.json",
        "nested/Header.stories.tsx",
      ]);
      expect(entries).not.toContain("shot-phone.png");
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(join(archivePath, ".."), { recursive: true, force: true });
    }
  });

  it("throws naming the harness path when configuration is missing", async () => {
    const { harnessConfigPath } = await loadScratch();
    const { createDirectionArchive } = await loadPromote();
    const expected = harnessConfigPath("promote-chat");

    expect(() => createDirectionArchive("promote-chat", "direction-a")).toThrow(
      `missing mockup harness configuration at ${expected}`,
    );
  });

  it("throws when the direction has no story files", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const { createDirectionArchive } = await loadPromote();

    directionDir("promote-chat", "direction-a");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, "{}");

    expect(() => createDirectionArchive("promote-chat", "direction-a")).toThrow(
      'no story files for direction "direction-a"',
    );
  });
});

describe("attachCapturedDirection", () => {
  it("attaches phone candidate PNGs under mockup-candidate- names", async () => {
    const { attachCapturedDirection } = await loadPromote();
    const { listAttachments } = await loadAttachments();

    const phone = join(root, "a-phone.png");
    writePng(phone, "a");

    const result = await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [capture("direction-a-card--default", "phone", phone)],
    });

    expect(result.attached).toEqual([
      "mockup-candidate-direction-a-direction-a-card-default-phone.png",
    ]);
    expect(result.capturePaths).toEqual([phone]);
    expect(listAttachments("src").map((att) => att.name)).toEqual(result.attached);
    expect(
      readFileSync(
        join(issuesDir, "src", "attachments", result.attached[0]!),
      ).toString(),
    ).toBe("png:a");
  });

  it("attaches both-viewport PNGs and the archive, then detaches every candidate", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const {
      attachCapturedDirection,
      candidateAttachmentName,
    } = await loadPromote();
    const { listAttachments, putAttachment } = await loadAttachments();

    await putAttachment(
      "src",
      candidateAttachmentName("direction-a", "direction-a-card--default"),
      Buffer.from("old-a"),
    );
    await putAttachment(
      "src",
      candidateAttachmentName("direction-b", "direction-b-list--default"),
      Buffer.from("old-b"),
    );

    const storiesDir = directionDir("promote-chat", "direction-a");
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const phone = join(root, "chosen-phone.png");
    const desktop = join(root, "chosen-desktop.png");
    writePng(phone, "phone");
    writePng(desktop, "desktop");

    const result = await attachCapturedDirection({
      mode: "chosen",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [
        capture("direction-a-card--default", "phone", phone),
        capture("direction-a-card--default", "desktop", desktop),
      ],
    });

    const names = listAttachments("src").map((att) => att.name).sort();
    expect(names).toEqual(
      [
        "mockup-direction-a-direction-a-card-default-desktop.png",
        "mockup-direction-a-direction-a-card-default-phone.png",
        "mockup-direction-a.tar.gz",
      ].sort(),
    );
    expect(names.some((name) => name.startsWith("mockup-candidate-"))).toBe(
      false,
    );
    expect(result.attached).toEqual([
      "mockup-direction-a-direction-a-card-default-phone.png",
      "mockup-direction-a-direction-a-card-default-desktop.png",
      "mockup-direction-a.tar.gz",
    ]);
    expect(result.capturePaths).toEqual([phone, desktop]);
  });

  it("throws naming an oversize file and attaches nothing", async () => {
    const { attachCapturedDirection } = await loadPromote();
    const { listAttachments } = await loadAttachments();

    const small = join(root, "small.png");
    const huge = join(root, "huge.png");
    writePng(small, "ok");
    writeFileSync(huge, new Uint8Array(MAX_ATTACHMENT_BYTES + 1));

    await expect(
      attachCapturedDirection({
        mode: "candidate",
        conversationId: "promote-chat",
        directionId: "direction-a",
        issueId: "src",
        captures: [
          capture("direction-a-card--default", "phone", small),
          capture("direction-a-card--hover", "phone", huge),
        ],
      }),
    ).rejects.toThrow(
      `attachment "mockup-candidate-direction-a-direction-a-card-hover-phone.png" exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    );
    expect(listAttachments("src")).toEqual([]);
  });
});

describe("copyDirectionArtifacts", () => {
  it("copies chosen PNGs and the archive without capturing", async () => {
    const { copyDirectionArtifacts } = await loadPromote();
    const { listAttachments, putAttachment } = await loadAttachments();

    await putAttachment(
      "src",
      "mockup-direction-a-card-default-phone.png",
      Buffer.from("phone"),
    );
    await putAttachment(
      "src",
      "mockup-direction-a-card-default-desktop.png",
      Buffer.from("desktop"),
    );
    await putAttachment("src", "mockup-direction-a.tar.gz", Buffer.from("archive"));
    await putAttachment(
      "src",
      "mockup-candidate-direction-a-card-default-phone.png",
      Buffer.from("candidate"),
    );
    await putAttachment("src", "notes.md", Buffer.from("ignore"));

    const result = await copyDirectionArtifacts({
      fromIssueId: "src",
      issueId: "dst",
      directionId: "direction-a",
    });

    expect(result.capturePaths).toEqual([]);
    expect(result.attached.sort()).toEqual([
      "mockup-direction-a-card-default-desktop.png",
      "mockup-direction-a-card-default-phone.png",
      "mockup-direction-a.tar.gz",
    ]);
    expect(listAttachments("dst").map((att) => att.name).sort()).toEqual(
      result.attached.sort(),
    );
  });

  it("throws naming the archive when the source issue lacks it", async () => {
    const { copyDirectionArtifacts } = await loadPromote();
    const { putAttachment } = await loadAttachments();

    await putAttachment(
      "src",
      "mockup-direction-a-card-default-phone.png",
      Buffer.from("phone"),
    );

    await expect(
      copyDirectionArtifacts({
        fromIssueId: "src",
        issueId: "dst",
        directionId: "direction-a",
      }),
    ).rejects.toThrow(
      'attachment "mockup-direction-a.tar.gz" not found on "src"',
    );
  });
});

describe("promoteMockup", () => {
  it("copy mode needs no conversation or stack", async () => {
    const { promoteMockup } = await loadPromote();
    const { putAttachment } = await loadAttachments();

    await putAttachment("src", "mockup-direction-a.tar.gz", Buffer.from("archive"));
    await putAttachment(
      "src",
      "mockup-direction-a-card-default-phone.png",
      Buffer.from("phone"),
    );

    const result = await promoteMockup({
      mode: "copy",
      directionId: "direction-a",
      issueId: "dst",
      fromIssueId: "src",
    });

    expect(result.attached.sort()).toEqual([
      "mockup-direction-a-card-default-phone.png",
      "mockup-direction-a.tar.gz",
    ]);
  });

  it("throws naming the conversation when no stack is running", async () => {
    const { promoteMockup } = await loadPromote();

    await expect(
      promoteMockup({
        mode: "candidate",
        directionId: "direction-a",
        issueId: "src",
        conversationId: "missing-conversation",
      }),
    ).rejects.toThrow(
      'no mockup stack running for conversation "missing-conversation"',
    );
  });

  it("rejects the other mode's exclusive flag", async () => {
    const { promoteMockup } = await loadPromote();

    await expect(
      promoteMockup({
        mode: "copy",
        directionId: "direction-a",
        issueId: "dst",
        fromIssueId: "src",
        conversationId: "promote-chat",
      }),
    ).rejects.toThrow(/--conversation is not used/);

    await expect(
      promoteMockup({
        mode: "candidate",
        directionId: "direction-a",
        issueId: "src",
        conversationId: "promote-chat",
        fromIssueId: "src",
      }),
    ).rejects.toThrow(/--from-issue is not used/);
  });
});
