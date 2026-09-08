import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachments.js";
import {
  capture,
  issuesDir,
  loadAttachments,
  loadConfig,
  loadConversationAttachments,
  loadPromote,
  loadScratch,
  root,
  useMockupPromoteTestFixtures,
  writePng,
} from "./mockup-promote.test-fixtures.js";

useMockupPromoteTestFixtures();

describe("attachCapturedDirection", () => {
  it("attaches candidate PNGs to the conversation store with revision names", async () => {
    const { attachCapturedDirection } = await loadPromote();
    const { listAttachments } = await loadAttachments();
    const { listConversationAttachments } = await loadConversationAttachments();
    const { conversationsDir } = await loadConfig();

    const phone = join(root, "a-phone.png");
    writePng(phone, "a");

    const result = await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      captures: [capture("direction-a-card--default", "phone", phone)],
    });

    expect(result.attached).toEqual([
      "mockup-candidate-direction-a-r1-card-default-phone.png",
    ]);
    expect(result.capturePaths).toEqual([phone]);
    expect(listAttachments("src")).toEqual([]);
    expect(await listConversationAttachments("promote-chat")).toEqual([
      expect.objectContaining({
        name: "mockup-candidate-direction-a-r1-card-default-phone.png",
      }),
    ]);
    expect(
      readFileSync(
        join(
          conversationsDir,
          "promote-chat",
          "attachments",
          result.attached[0]!,
        ),
      ).toString(),
    ).toBe("png:a");
  });

  it("attaches both-viewport PNGs and the archive for chosen mode", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const { attachCapturedDirection } = await loadPromote();
    const { listAttachments } = await loadAttachments();

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
    expect(result.attached).toEqual([
      "mockup-direction-a-card-default-phone.png",
      "mockup-direction-a-card-default-desktop.png",
      "mockup-direction-a.tar.gz",
    ]);
    expect(result.capturePaths).toEqual([phone, desktop]);
  });

  it("leaves conversation candidate attachments untouched on chosen promote", async () => {
    const { directionDir, harnessConfigPath } = await loadScratch();
    const {
      attachCapturedDirection,
      candidateAttachmentName,
    } = await loadPromote();
    const { listAttachments } = await loadAttachments();
    const { listConversationAttachments } = await loadConversationAttachments();
    const { conversationsDir } = await loadConfig();

    const aPhone = join(root, "a-phone.png");
    const bDesktop = join(root, "b-desktop.png");
    writePng(aPhone, "a-phone");
    writePng(bDesktop, "b-desktop");

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      captures: [capture("direction-a-card--default", "phone", aPhone)],
    });
    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-b",
      captures: [capture("direction-b-list--default", "desktop", bDesktop)],
    });

    const candidateA = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
      1,
    );
    const candidateB = candidateAttachmentName(
      "direction-b",
      "direction-b-list--default",
      "desktop",
      1,
    );

    const storiesDir = directionDir("promote-chat", "direction-a");
    writeFileSync(join(storiesDir, "Card.stories.tsx"), "export const Default = {};");
    const harnessPath = harnessConfigPath("promote-chat");
    mkdirSync(join(harnessPath, ".."), { recursive: true });
    writeFileSync(harnessPath, JSON.stringify({ ok: true }));

    const chosenPhone = join(root, "chosen-phone.png");
    const chosenDesktop = join(root, "chosen-desktop.png");
    writePng(chosenPhone, "chosen-phone");
    writePng(chosenDesktop, "chosen-desktop");

    await attachCapturedDirection({
      mode: "chosen",
      conversationId: "promote-chat",
      directionId: "direction-a",
      issueId: "src",
      captures: [
        capture("direction-a-card--default", "phone", chosenPhone),
        capture("direction-a-card--default", "desktop", chosenDesktop),
      ],
    });

    const issueNames = listAttachments("src").map((att) => att.name).sort();
    expect(issueNames).toEqual(
      [
        "mockup-direction-a-card-default-desktop.png",
        "mockup-direction-a-card-default-phone.png",
        "mockup-direction-a.tar.gz",
      ].sort(),
    );

    const conversationNames = (await listConversationAttachments("promote-chat"))
      .map((att) => att.name)
      .sort();
    expect(conversationNames).toEqual([candidateA, candidateB].sort());
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", candidateA),
      ).toString(),
    ).toBe("png:a-phone");
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", candidateB),
      ).toString(),
    ).toBe("png:b-desktop");
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
        captures: [
          capture("direction-a-card--default", "phone", small),
          capture("direction-a-card--hover", "phone", huge),
        ],
      }),
    ).rejects.toThrow(
      `attachment "mockup-candidate-direction-a-r1-card-hover-phone.png" exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
    );
    expect(listAttachments("src")).toEqual([]);
    const { listConversationAttachments } = await loadConversationAttachments();
    expect(await listConversationAttachments("promote-chat")).toEqual([]);
  });

  it("stores a second revision alongside the first without replacing it", async () => {
    const { attachCapturedDirection, candidateAttachmentName } =
      await loadPromote();
    const { listAttachments } = await loadAttachments();
    const { listConversationAttachments } = await loadConversationAttachments();
    const { conversationsDir } = await loadConfig();

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

    const aPhoneR1 = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
      1,
    );
    const aDesktopR1 = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "desktop",
      1,
    );
    const bPhoneR1 = candidateAttachmentName(
      "direction-b",
      "direction-b-list--default",
      "phone",
      1,
    );
    const aPhoneR2 = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "phone",
      2,
    );
    const aDesktopR2 = candidateAttachmentName(
      "direction-a",
      "direction-a-card--default",
      "desktop",
      2,
    );

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      captures: [
        capture("direction-a-card--default", "phone", aPhoneFirst),
        capture("direction-a-card--default", "desktop", aDesktopFirst),
      ],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-b",
      captures: [capture("direction-b-list--default", "phone", bPhone)],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "direction-a",
      captures: [
        capture("direction-a-card--default", "phone", aPhoneSecond),
        capture("direction-a-card--default", "desktop", aDesktopSecond),
      ],
    });

    expect(listAttachments("src")).toEqual([]);
    const names = (await listConversationAttachments("promote-chat"))
      .map((att) => att.name)
      .sort();
    expect(names).toEqual(
      [aDesktopR1, aDesktopR2, aPhoneR1, aPhoneR2, bPhoneR1].sort(),
    );
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", aPhoneR1),
      ).toString(),
    ).toBe("png:a-phone-first");
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", aPhoneR2),
      ).toString(),
    ).toBe("png:a-phone-second");
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", bPhoneR1),
      ).toString(),
    ).toBe("png:b-phone");
  });

  it("does not detach prefix-colliding directions during candidate-only review", async () => {
    const { attachCapturedDirection, candidateAttachmentName } =
      await loadPromote();
    const { directionDir } = await loadScratch();
    const { listConversationAttachments } = await loadConversationAttachments();
    const { conversationsDir } = await loadConfig();

    directionDir("promote-chat", "grid");
    directionDir("promote-chat", "grid-lightbox");

    const gridPhoneFirst = join(root, "grid-phone-first.png");
    const lightboxPhone = join(root, "lightbox-phone.png");
    const gridPhoneSecond = join(root, "grid-phone-second.png");
    writePng(gridPhoneFirst, "grid-first");
    writePng(lightboxPhone, "lightbox");
    writePng(gridPhoneSecond, "grid-second");

    const gridPhoneR1 = candidateAttachmentName(
      "grid",
      "grid/card--default",
      "phone",
      1,
    );
    const lightboxPhoneR1 = candidateAttachmentName(
      "grid-lightbox",
      "grid-lightbox/card--default",
      "phone",
      1,
    );
    const gridPhoneR2 = candidateAttachmentName(
      "grid",
      "grid/card--default",
      "phone",
      2,
    );

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid",
      captures: [capture("grid/card--default", "phone", gridPhoneFirst)],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid-lightbox",
      captures: [
        capture("grid-lightbox/card--default", "phone", lightboxPhone),
      ],
    });

    await attachCapturedDirection({
      mode: "candidate",
      conversationId: "promote-chat",
      directionId: "grid",
      captures: [capture("grid/card--default", "phone", gridPhoneSecond)],
    });

    const names = (await listConversationAttachments("promote-chat"))
      .map((att) => att.name)
      .sort();
    expect(names).toEqual([gridPhoneR1, gridPhoneR2, lightboxPhoneR1].sort());
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", gridPhoneR2),
      ).toString(),
    ).toBe("png:grid-second");
    expect(
      readFileSync(
        join(conversationsDir, "promote-chat", "attachments", lightboxPhoneR1),
      ).toString(),
    ).toBe("png:lightbox");
  });
});
