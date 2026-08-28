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

const mockCaptureMockupStoryStates = vi.fn();

vi.mock("./mockup-capture.js", () => ({
  captureMockupStoryStates: (...args: unknown[]) =>
    mockCaptureMockupStoryStates(...args),
}));

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

async function loadConfig() {
  return import("../config.js");
}

function writeConversationMeta(
  conversationsDir: string,
  conversationId: string,
  overrides: { agentId?: string } = {},
): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id: conversationId,
      title: conversationId,
      projectId: "p",
      model: "composer-2.5",
      createdAt: AT,
      updatedAt: AT,
      archived: false,
      ...overrides,
    }),
  );
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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-promote-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedIssues();
  const { conversationsDir } = await loadConfig();
  writeConversationMeta(conversationsDir, "promote-chat");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("attachment names", () => {
  it("uses slugified story ids and viewport suffixes in candidate and chosen names", async () => {
    const {
      candidateAttachmentName,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();

    expect(
      candidateAttachmentName("direction-a", "direction-a-card--default", "phone"),
    ).toBe("mockup-candidate-direction-a-card-default-phone.png");
    expect(
      candidateAttachmentName(
        "direction-a",
        "direction-a-card--default",
        "desktop",
      ),
    ).toBe("mockup-candidate-direction-a-card-default-desktop.png");
    expect(
      chosenAttachmentName("direction-a", "direction-a-card--default", "desktop"),
    ).toBe("mockup-direction-a-card-default-desktop.png");
    expect(chosenArchiveName("direction-a")).toBe("mockup-direction-a.tar.gz");
  });

  it("matches canonical and collision archive names for replace", async () => {
    const { chosenArchiveName, matchesChosenArchiveForReplace } =
      await loadPromote();

    expect(
      matchesChosenArchiveForReplace(
        chosenArchiveName("inline-prominent"),
        "inline-prominent",
      ),
    ).toBe(true);
    expect(
      matchesChosenArchiveForReplace(
        "mockup-inline-prominent.tar-2.gz",
        "inline-prominent",
      ),
    ).toBe(true);
    expect(
      matchesChosenArchiveForReplace(
        "mockup-inline-prominent.tar-10.gz",
        "inline-prominent",
      ),
    ).toBe(true);
    expect(
      matchesChosenArchiveForReplace(
        "mockup-inline-prominent-v2.tar.gz",
        "inline-prominent",
      ),
    ).toBe(false);
    expect(
      matchesChosenArchiveForReplace(
        chosenArchiveName("grid-lightbox"),
        "grid",
      ),
    ).toBe(false);
    expect(
      matchesChosenArchiveForReplace(
        "mockup-inline-prominent.tar-1.gz",
        "inline-prominent",
      ),
    ).toBe(false);
  });

  it("strips one leading direction segment from state slugs and keeps prefix-safe matching", async () => {
    const {
      stateSlug,
      candidateAttachmentName,
      chosenAttachmentName,
      copyDirectionArtifacts,
    } = await loadPromote();
    const { putAttachment } = await loadAttachments();

    expect(stateSlug("grid/gallery-grid-attachmentspanel-empty", "grid")).toBe(
      "gallery-grid-attachmentspanel-empty",
    );
    expect(
      stateSlug("grid-lightbox/gallery-grid-attachmentspanel-empty", "grid-lightbox"),
    ).toBe("gallery-grid-attachmentspanel-empty");
    expect(stateSlug("grid-lightbox/card--default", "grid")).toBe(
      "lightbox-card-default",
    );

    expect(
      candidateAttachmentName("grid", "grid/gallery-grid-attachmentspanel-empty", "phone"),
    ).toBe("mockup-candidate-grid-gallery-grid-attachmentspanel-empty-phone.png");
    expect(
      candidateAttachmentName(
        "grid-lightbox",
        "grid-lightbox/gallery-grid-attachmentspanel-empty",
        "phone",
      ),
    ).toBe(
      "mockup-candidate-grid-lightbox-gallery-grid-attachmentspanel-empty-phone.png",
    );
    expect(
      chosenAttachmentName("grid", "grid/card--default", "desktop"),
    ).toBe("mockup-grid-card-default-desktop.png");

    await putAttachment(
      "src",
      "mockup-grid-card-default-phone.png",
      Buffer.from("grid-phone"),
    );
    await putAttachment("src", "mockup-grid.tar.gz", Buffer.from("grid-archive"));
    await putAttachment(
      "src",
      "mockup-grid-lightbox-card-default-phone.png",
      Buffer.from("lightbox-phone"),
    );
    await putAttachment(
      "src",
      "mockup-grid-lightbox.tar.gz",
      Buffer.from("lightbox-archive"),
    );

    const gridCopy = await copyDirectionArtifacts({
      fromIssueId: "src",
      issueId: "dst",
      directionId: "grid",
    });
    expect(gridCopy.attached.sort()).toEqual([
      "mockup-grid-card-default-phone.png",
      "mockup-grid.tar.gz",
    ]);
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
  it("attaches candidate PNGs under mockup-candidate- names with viewport suffixes", async () => {
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
      "mockup-candidate-direction-a-card-default-phone.png",
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
      candidateAttachmentName(
        "direction-a",
        "direction-a-card--default",
        "phone",
      ),
      Buffer.from("old-a"),
    );
    await putAttachment(
      "src",
      candidateAttachmentName(
        "direction-b",
        "direction-b-list--default",
        "desktop",
      ),
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
        "mockup-direction-a-card-default-desktop.png",
        "mockup-direction-a-card-default-phone.png",
        "mockup-direction-a.tar.gz",
      ].sort(),
    );
    expect(names.some((name) => name.startsWith("mockup-candidate-"))).toBe(
      false,
    );
    expect(result.attached).toEqual([
      "mockup-direction-a-card-default-phone.png",
      "mockup-direction-a-card-default-desktop.png",
      "mockup-direction-a.tar.gz",
    ]);
    expect(result.capturePaths).toEqual([phone, desktop]);
  });

  it("replaces one direction's chosen PNGs on re-promote and sweeps collision copies", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const {
      attachCapturedDirection,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();
    const { listAttachments, putAttachment } = await loadAttachments();

    const storiesDir = directionDir("promote-chat", "direction-a");
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const phoneName = chosenAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
    );
    const desktopName = chosenAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "desktop",
    );

    await putAttachment("src", phoneName, Buffer.from("old-phone"));
    await putAttachment("src", desktopName, Buffer.from("old-desktop"));
    await putAttachment(
      "src",
      `${phoneName.replace(/\.png$/, "-2.png")}`,
      Buffer.from("leftover-phone-2"),
    );

    const phone = join(root, "chosen-phone-new.png");
    const desktop = join(root, "chosen-desktop-new.png");
    writePng(phone, "phone-new");
    writePng(desktop, "desktop-new");

    await attachCapturedDirection({
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
    expect(names).toEqual([desktopName, phoneName, chosenArchiveName("direction-a")].sort());
    expect(names.some((name) => name.endsWith("-2.png"))).toBe(false);
    expect(
      readFileSync(join(issuesDir, "src", "attachments", phoneName)).toString(),
    ).toBe("png:phone-new");
    expect(
      readFileSync(join(issuesDir, "src", "attachments", desktopName)).toString(),
    ).toBe("png:desktop-new");
  });

  it("replaces one direction's chosen archive on re-promote and sweeps collision copies", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const {
      attachCapturedDirection,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();
    const { listAttachments, putAttachment } = await loadAttachments();

    const storiesDir = directionDir("promote-chat", "direction-a");
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const phoneName = chosenAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
    );
    const archiveName = chosenArchiveName("direction-a");

    await putAttachment("src", phoneName, Buffer.from("old-phone"));
    await putAttachment("src", archiveName, Buffer.from("old-archive"));
    await putAttachment(
      "src",
      "mockup-direction-a.tar-2.gz",
      Buffer.from("leftover-archive-2"),
    );
    await putAttachment(
      "src",
      chosenArchiveName("direction-b"),
      Buffer.from("direction-b-archive"),
    );

    const phone = join(root, "chosen-phone-new.png");
    writePng(phone, "phone-new");

    await attachCapturedDirection({
      mode: "chosen",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [capture("direction-a-card--default", "phone", phone)],
    });

    const names = listAttachments("src").map((att) => att.name).sort();
    expect(names).toEqual([archiveName, phoneName, chosenArchiveName("direction-b")].sort());
    expect(names.some((name) => name.endsWith(".tar-2.gz"))).toBe(false);
    expect(
      readFileSync(join(issuesDir, "src", "attachments", archiveName)).toString(),
    ).not.toBe("old-archive");
    expect(
      readFileSync(
        join(issuesDir, "src", "attachments", chosenArchiveName("direction-b")),
      ).toString(),
    ).toBe("direction-b-archive");
  });

  it("does not detach prefix-colliding directions during chosen re-promote", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const {
      attachCapturedDirection,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();
    const { listAttachments, putAttachment } = await loadAttachments();

    const gridDir = directionDir("promote-chat", "grid");
    writeFileSync(join(gridDir, "Card.stories.tsx"), "export const Default = {};");
    const lightboxDir = directionDir("promote-chat", "grid-lightbox");
    writeFileSync(join(lightboxDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const gridPhoneName = chosenAttachmentName("grid", "grid/card--default", "phone");
    const lightboxPhoneName = chosenAttachmentName(
      "grid-lightbox",
      "grid-lightbox/card--default",
      "phone",
    );

    await putAttachment("src", gridPhoneName, Buffer.from("old-grid-phone"));
    await putAttachment("src", lightboxPhoneName, Buffer.from("lightbox-phone"));
    await putAttachment(
      "src",
      chosenArchiveName("grid-lightbox"),
      Buffer.from("lightbox-archive"),
    );

    const gridPhoneNew = join(root, "grid-phone-new.png");
    writePng(gridPhoneNew, "grid-new");

    await attachCapturedDirection({
      mode: "chosen",
      conversationId: "promote-chat",
      directionId: "grid",
      issueId: "src",
      captures: [capture("grid/card--default", "phone", gridPhoneNew)],
    });

    const names = listAttachments("src").map((att) => att.name).sort();
    expect(names).toEqual(
      [
        gridPhoneName,
        chosenArchiveName("grid"),
        lightboxPhoneName,
        chosenArchiveName("grid-lightbox"),
      ].sort(),
    );
    expect(
      readFileSync(join(issuesDir, "src", "attachments", gridPhoneName)).toString(),
    ).toBe("png:grid-new");
    expect(
      readFileSync(
        join(issuesDir, "src", "attachments", lightboxPhoneName),
      ).toString(),
    ).toBe("lightbox-phone");
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
      `attachment "mockup-candidate-direction-a-card-hover-phone.png" exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    );
    expect(listAttachments("src")).toEqual([]);
  });

  it("replaces one direction's candidates on repeat without touching others", async () => {
    const { attachCapturedDirection, candidateAttachmentName } =
      await loadPromote();
    const { listAttachments } = await loadAttachments();

    const aPhoneFirst = join(root, "a-phone-first.png");
    const aDesktopFirst = join(root, "a-desktop-first.png");
    const bPhone = join(root, "b-phone.png");
    const aPhoneSecond = join(root, "a-phone-second.png");
    const aDesktopSecond = join(root, "a-desktop-second.png");
    writePng(aPhoneFirst, "a-phone-first");
    writePng(aDesktopFirst, "a-desktop-first");
    writePng(bPhone, "b-phone");
    writePng(aPhoneSecond, "a-phone-second");
    writePng(aDesktopSecond, "a-desktop-second");

    const aPhoneName = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
    );
    const aDesktopName = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "desktop",
    );
    const bPhoneName = candidateAttachmentName(
      "direction-b",
      "direction-b-list--default",
      "phone",
    );

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [
        capture("direction-a-card--default", "phone", aPhoneFirst),
        capture("direction-a-card--default", "desktop", aDesktopFirst),
      ],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-b",
      issueId: "src",
      captures: [capture("direction-b-list--default", "phone", bPhone)],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [
        capture("direction-a-card--default", "phone", aPhoneSecond),
        capture("direction-a-card--default", "desktop", aDesktopSecond),
      ],
    });

    const names = listAttachments("src").map((att) => att.name).sort();
    expect(names).toEqual([aDesktopName, aPhoneName, bPhoneName].sort());
    expect(
      readFileSync(join(issuesDir, "src", "attachments", aPhoneName)).toString(),
    ).toBe("png:a-phone-second");
    expect(
      readFileSync(
        join(issuesDir, "src", "attachments", aDesktopName),
      ).toString(),
    ).toBe("png:a-desktop-second");
    expect(
      readFileSync(join(issuesDir, "src", "attachments", bPhoneName)).toString(),
    ).toBe("png:b-phone");
  });

  it("does not detach prefix-colliding directions during candidate-only review", async () => {
    const { attachCapturedDirection, candidateAttachmentName } =
      await loadPromote();
    const { directionDir } = await loadScratch();
    const { listAttachments } = await loadAttachments();

    directionDir("promote-chat", "grid");
    directionDir("promote-chat", "grid-lightbox");

    const gridPhoneFirst = join(root, "grid-phone-first.png");
    const lightboxPhone = join(root, "lightbox-phone.png");
    const gridPhoneSecond = join(root, "grid-phone-second.png");
    writePng(gridPhoneFirst, "grid-first");
    writePng(lightboxPhone, "lightbox");
    writePng(gridPhoneSecond, "grid-second");

    const gridPhoneName = candidateAttachmentName(
      "grid",
      "grid/card--default",
      "phone",
    );
    const lightboxPhoneName = candidateAttachmentName(
      "grid-lightbox",
      "grid-lightbox/card--default",
      "phone",
    );

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid",
      issueId: "src",
      captures: [capture("grid/card--default", "phone", gridPhoneFirst)],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid-lightbox",
      issueId: "src",
      captures: [
        capture("grid-lightbox/card--default", "phone", lightboxPhone),
      ],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid",
      issueId: "src",
      captures: [capture("grid/card--default", "phone", gridPhoneSecond)],
    });

    const names = listAttachments("src").map((att) => att.name).sort();
    expect(names).toEqual([gridPhoneName, lightboxPhoneName].sort());
    expect(
      readFileSync(join(issuesDir, "src", "attachments", gridPhoneName)).toString(),
    ).toBe("png:grid-second");
    expect(
      readFileSync(
        join(issuesDir, "src", "attachments", lightboxPhoneName),
      ).toString(),
    ).toBe("png:lightbox");
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

  it("candidate mode captures both viewports", async () => {
    const { promoteMockup } = await loadPromote();
    const { directionDir, harnessConfigPath } = await loadScratch();

    const storiesDir = directionDir("promote-chat", "direction-a");
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const phone = join(root, "candidate-phone.png");
    const desktop = join(root, "candidate-desktop.png");
    writePng(phone, "phone");
    writePng(desktop, "desktop");

    mockCaptureMockupStoryStates.mockResolvedValue([
      capture("direction-a-card--default", "phone", phone),
      capture("direction-a-card--default", "desktop", desktop),
    ]);

    const result = await promoteMockup({
      mode: "candidate",
      directionId: "direction-a",
      issueId: "src",
      conversationId: "promote-chat",
    });

    expect(mockCaptureMockupStoryStates).toHaveBeenCalledWith({
      conversationId: "promote-chat",
      directionId: "direction-a",
      viewports: ["phone", "desktop"],
    });
    expect(result.attached.sort()).toEqual([
      "mockup-candidate-direction-a-card-default-desktop.png",
      "mockup-candidate-direction-a-card-default-phone.png",
    ]);
  });

  it("throws naming the conversation when no stack is running", async () => {
    const { promoteMockup } = await loadPromote();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "missing-conversation");

    mockCaptureMockupStoryStates.mockRejectedValue(
      new Error(
        'no mockup stack running for conversation "missing-conversation"',
      ),
    );

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
