import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capture,
  mockCaptureMockupStoryStates,
  root,
  useMockupPromoteTestFixtures,
  writeConversationMeta,
  writePng,
  loadAttachments,
  loadConfig,
  loadConversationAttachments,
  loadPromote,
  loadScratch,
} from "./mockup-promote.test-fixtures.js";

useMockupPromoteTestFixtures();

describe("attachment names", () => {
  it("uses slugified story ids and viewport suffixes in candidate and chosen names", async () => {
    const {
      candidateAttachmentName,
      chosenAttachmentName,
      chosenArchiveName,
    } = await loadPromote();

    expect(
      candidateAttachmentName("direction-a", "direction-a-card--default", "phone", 1),
    ).toBe("mockup-candidate-direction-a-r1-card-default-phone.png");
    expect(
      candidateAttachmentName(
        "direction-a",
        "direction-a-card--default",
        "desktop",
        2,
      ),
    ).toBe("mockup-candidate-direction-a-r2-card-default-desktop.png");
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
      candidateAttachmentName("grid", "grid/gallery-grid-attachmentspanel-empty", "phone", 1),
    ).toBe("mockup-candidate-grid-r1-gallery-grid-attachmentspanel-empty-phone.png");
    expect(
      candidateAttachmentName(
        "grid-lightbox",
        "grid-lightbox/gallery-grid-attachmentspanel-empty",
        "phone",
        1,
      ),
    ).toBe(
      "mockup-candidate-grid-lightbox-r1-gallery-grid-attachmentspanel-empty-phone.png",
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
      conversationId: "promote-chat",
    });

    expect(mockCaptureMockupStoryStates).toHaveBeenCalledWith({
      conversationId: "promote-chat",
      directionId: "direction-a",
      viewports: ["phone", "desktop"],
    });
    expect(result.attached.sort()).toEqual([
      "mockup-candidate-direction-a-r1-card-default-desktop.png",
      "mockup-candidate-direction-a-r1-card-default-phone.png",
    ]);
    const { listConversationAttachments } = await loadConversationAttachments();
    expect(
      (await listConversationAttachments("promote-chat")).map((att) => att.name).sort(),
    ).toEqual(result.attached.sort());
    const { listAttachments } = await loadAttachments();
    expect(listAttachments("src")).toEqual([]);
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
      }),
    ).rejects.toThrow(/--issue is not used with --mode candidate/);

    await expect(
      promoteMockup({
        mode: "chosen",
        directionId: "direction-a",
        issueId: "src",
        conversationId: "promote-chat",
        fromIssueId: "src",
      }),
    ).rejects.toThrow(/--from-issue is not used/);
  });
});
