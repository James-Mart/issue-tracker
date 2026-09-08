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
  loadAttachments,
  loadPromote,
  loadScratch,
  useMockupPromoteTestFixtures,
} from "./mockup-promote.test-fixtures.js";

useMockupPromoteTestFixtures();

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
