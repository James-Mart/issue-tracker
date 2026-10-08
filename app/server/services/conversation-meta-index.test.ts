import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  conversationRoot,
  loadService,
  useConversationFixtures,
} from "./conversations.test-fixtures.js";

useConversationFixtures();

function seedMeta(
  id: string,
  updatedAt: string,
  extra: Record<string, unknown> = {},
): void {
  const dir = join(conversationRoot(), "conversations", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify({
      id,
      title: id,
      projectId: "platform",
      model: "auto",
      createdAt: updatedAt,
      updatedAt,
      ...extra,
    })}\n`,
  );
}

describe("conversation metadata index", () => {
  it("builds from disk on first use and skips unreadable directories", async () => {
    seedMeta("older", "2026-01-01T00:00:00.000Z");
    seedMeta("newer", "2026-06-01T00:00:00.000Z");
    mkdirSync(join(conversationRoot(), "conversations", "side-state"), {
      recursive: true,
    });
    const bad = join(conversationRoot(), "conversations", "broken");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "meta.json"), "{not json");

    const { listConversations } = await loadService();
    expect(listConversations().map((meta) => meta.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("serves later lists from memory and write-through updates", async () => {
    seedMeta("seed", "2026-01-01T00:00:00.000Z");
    const {
      appendEvent,
      createConversation,
      createForkedConversation,
      deleteConversation,
      listConversations,
      updateMeta,
    } = await loadService();

    expect(listConversations().map((meta) => meta.id)).toEqual(["seed"]);

    const created = await createConversation({
      title: "Fresh",
      projectId: "platform",
      model: "auto",
    });
    seedMeta("outsider", "2026-12-01T00:00:00.000Z");

    const afterCreate = listConversations();
    expect(afterCreate.map((meta) => meta.id)).toContain(created.id);
    expect(afterCreate.map((meta) => meta.id)).not.toContain("outsider");
    expect(afterCreate.find((meta) => meta.id === created.id)?.title).toBe(
      "Fresh",
    );

    await updateMeta(created.id, { title: "Renamed" });
    expect(
      listConversations().find((meta) => meta.id === created.id)?.title,
    ).toBe("Renamed");

    await updateMeta(created.id, { archived: true });
    expect(
      listConversations().find((meta) => meta.id === created.id)?.archived,
    ).toBe(true);

    const forked = await createForkedConversation({
      title: "Forked child",
      projectId: "platform",
      model: "auto",
      agentId: "agent-1",
      forkedFrom: created.id,
      forkedAtSeq: 0,
    });
    expect(listConversations().some((meta) => meta.id === forked.id)).toBe(
      true,
    );

    await appendEvent("seed", { type: "prompt", text: "hi" });
    expect(listConversations()[0]?.id).toBe("seed");

    await deleteConversation(created.id);
    const afterDelete = listConversations().map((meta) => meta.id);
    expect(afterDelete).not.toContain(created.id);
    expect(afterDelete).not.toContain("outsider");
    expect(afterDelete).toContain(forked.id);
  });
});
