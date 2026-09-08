import { describe, expect, it } from "vitest";
import {
  loadAttachments,
  loadPromote,
  useMockupPromoteTestFixtures,
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
