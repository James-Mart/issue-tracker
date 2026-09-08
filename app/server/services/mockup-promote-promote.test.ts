import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capture,
  loadAttachments,
  loadConfig,
  loadConversationAttachments,
  loadPromote,
  loadScratch,
  mockCaptureMockupStoryStates,
  root,
  useMockupPromoteTestFixtures,
  writeConversationMeta,
  writePng,
} from "./mockup-promote.test-fixtures.js";

useMockupPromoteTestFixtures();

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
