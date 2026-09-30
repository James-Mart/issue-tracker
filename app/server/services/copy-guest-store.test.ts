import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyGuestStore,
  DEFAULT_BYTE_CAP,
  DEFAULT_CONVERSATION_CAP,
  formatCopyGuestStoreResult,
} from "./copy-guest-store.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function writeConversation(
  conversationsDir: string,
  id: string,
  updatedAt: string,
  body = "hello",
): void {
  const dir = join(conversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify({
      id,
      title: id,
      projectId: "proj",
      model: "composer-2.5",
      createdAt: updatedAt,
      updatedAt,
    })}\n`,
  );
  writeFileSync(join(dir, "transcript.jsonl"), `${body}\n`);
}

function writeIssue(sourceRoot: string, id: string): void {
  const dir = join(sourceRoot, "issues", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "issue.json"),
    `${JSON.stringify({ id, kind: "task", title: id, partOf: "story" })}\n`,
  );
}

describe("copyGuestStore", () => {
  it("refuses when AGENT_STACK_DATA_DIR is unset", () => {
    const into = tempDir("guest-copy-into-");
    expect(() =>
      copyGuestStore({ into, sourceRoot: tempDir("guest-copy-src-"), dataDir: "" }),
    ).toThrow("AGENT_STACK_DATA_DIR unset");
  });

  it("refuses when --into resolves outside AGENT_STACK_DATA_DIR", () => {
    const data = tempDir("guest-copy-data-");
    const outside = tempDir("guest-copy-out-");
    const into = join(outside, "guest");
    mkdirSync(into);
    expect(() =>
      copyGuestStore({
        into,
        sourceRoot: tempDir("guest-copy-src-"),
        dataDir: data,
      }),
    ).toThrow("is not under AGENT_STACK_DATA_DIR");
  });

  it("refuses when the source issues store is missing", () => {
    const data = tempDir("guest-copy-data-");
    const source = tempDir("guest-copy-src-");
    const into = join(data, "guest");
    expect(() =>
      copyGuestStore({
        into,
        sourceRoot: source,
        dataDir: data,
      }),
    ).toThrow("source issues store missing");
  });

  it("refuses when the target already holds a store", () => {
    const data = tempDir("guest-copy-data-");
    const into = join(data, "guest");
    mkdirSync(join(into, "issues"), { recursive: true });
    expect(() =>
      copyGuestStore({
        into,
        sourceRoot: tempDir("guest-copy-src-"),
        dataDir: data,
      }),
    ).toThrow("already holds a store");
  });

  it("copies issues without the store lock and copies peer config", () => {
    const data = tempDir("guest-copy-data-");
    const source = tempDir("guest-copy-src-");
    writeIssue(source, "task-a");
    writeFileSync(join(source, "issues", ".store.lock"), '{"pid":1}\n');
    writeFileSync(join(source, "app-config.json"), '{"theme":"dark"}\n');
    writeFileSync(
      join(source, "model-slug-catalog.json"),
      '{"fetchedAt":"2026-01-01T00:00:00.000Z","models":[{"id":"composer-2.5","displayName":"Composer"}]}\n',
    );
    writeFileSync(join(source, "backup-status.json"), '{"lastSnapshotAt":"x"}\n');
    mkdirSync(join(source, "backup-mirror"), { recursive: true });
    writeFileSync(join(source, "backup-mirror", "marker"), "x");

    const into = join(data, "guest");
    const result = copyGuestStore({ into, sourceRoot: source, dataDir: data });

    expect(result.issues).toBe(1);
    expect(existsSync(join(into, "issues", ".store.lock"))).toBe(false);
    expect(readFileSync(join(into, "app-config.json"), "utf8")).toContain("dark");
    expect(existsSync(join(into, "model-slug-catalog.json"))).toBe(true);
    expect(existsSync(join(into, "backup-status.json"))).toBe(false);
    expect(existsSync(join(into, "backup-mirror"))).toBe(false);
  });

  it("copies newest conversations first, skips agent-state and agent-stack, and respects caps", () => {
    const data = tempDir("guest-copy-data-");
    const source = tempDir("guest-copy-src-");
    mkdirSync(join(source, "issues"), { recursive: true });
    const conversations = join(source, "conversations");
    writeConversation(conversations, "old", "2026-01-01T00:00:00.000Z");
    writeConversation(conversations, "new", "2026-02-01T00:00:00.000Z");
    writeConversation(conversations, "mid", "2026-01-15T00:00:00.000Z");
    mkdirSync(join(conversations, "new", "agent-state", "nested"), { recursive: true });
    writeFileSync(join(conversations, "new", "agent-state", "nested", "state.ndjson"), "x".repeat(100));
    mkdirSync(join(conversations, "new", "agent-stack"), { recursive: true });
    writeFileSync(join(conversations, "new", "agent-stack", "state.json"), "{}");
    mkdirSync(join(conversations, "agent-stack-cursor-index"), { recursive: true });
    writeFileSync(join(conversations, "agent-stack-cursor-index", "x.json"), "{}");

    const into = join(data, "guest");
    const result = copyGuestStore({
      into,
      sourceRoot: source,
      dataDir: data,
      conversationCap: 2,
      byteCap: DEFAULT_BYTE_CAP,
    });

    expect(result.conversations).toBe(2);
    expect(existsSync(join(into, "conversations", "new"))).toBe(true);
    expect(existsSync(join(into, "conversations", "mid"))).toBe(true);
    expect(existsSync(join(into, "conversations", "old"))).toBe(false);
    expect(existsSync(join(into, "conversations", "new", "agent-state"))).toBe(false);
    expect(existsSync(join(into, "conversations", "new", "agent-stack"))).toBe(false);
    expect(existsSync(join(into, "conversations", "agent-stack-cursor-index"))).toBe(false);
  });

  it("skips conversations that exceed the remaining byte budget without truncating", () => {
    const data = tempDir("guest-copy-data-");
    const source = tempDir("guest-copy-src-");
    mkdirSync(join(source, "issues"), { recursive: true });
    const conversations = join(source, "conversations");
    writeConversation(conversations, "big", "2026-02-01T00:00:00.000Z", "x".repeat(200));
    writeConversation(conversations, "small", "2026-01-01T00:00:00.000Z", "y");

    const into = join(data, "guest");
    const result = copyGuestStore({
      into,
      sourceRoot: source,
      dataDir: data,
      conversationCap: DEFAULT_CONVERSATION_CAP,
      byteCap: 250,
    });

    expect(result.conversations).toBe(1);
    expect(existsSync(join(into, "conversations", "big"))).toBe(false);
    expect(existsSync(join(into, "conversations", "small"))).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(250);
  });

  it("allows a symlinked AGENT_STACK_DATA_DIR when the real target is inside it", () => {
    const data = tempDir("guest-copy-data-");
    const source = tempDir("guest-copy-src-");
    writeIssue(source, "task-a");
    const outside = tempDir("guest-copy-out-");
    const dataLink = join(outside, "data-link");
    symlinkSync(data, dataLink);
    const into = join(dataLink, "guest");

    const result = copyGuestStore({
      into,
      sourceRoot: source,
      dataDir: dataLink,
    });

    expect(result.issues).toBe(1);
    expect(existsSync(join(realpathSync(into), "issues", "task-a"))).toBe(true);
  });

  it("formats summary counts for stdout", () => {
    expect(
      formatCopyGuestStoreResult({ issues: 3, conversations: 2, bytes: 4096 }),
    ).toBe("issues=3\nconversations=2\nbytes=4096");
  });
});
