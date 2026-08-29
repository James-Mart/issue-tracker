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
import { MAX_ATTACHMENT_BYTES } from "./attachments.js";

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;
let conversationsDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function writeConversation(id: string): void {
  mkdirSync(join(conversationsDir, id), { recursive: true });
  writeFileSync(
    join(conversationsDir, id, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test chat",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(conversationsDir, id, "transcript.jsonl"), "");
  writeFileSync(join(conversationsDir, id, "delegations.jsonl"), "");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-conversation-attachments-"));
  issuesDir = join(root, "issues");
  conversationsDir = join(root, "conversations");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeConversation("test-chat");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./conversation-attachments.js");
}

describe("conversation attachments", () => {
  it("round-trips put, get, list, and remove", async () => {
    const {
      listConversationAttachments,
      putConversationAttachment,
      getConversationAttachment,
      removeConversationAttachment,
    } = await loadService();

    expect(await listConversationAttachments("test-chat")).toEqual([]);

    const payload = Buffer.from("export const x = 1;\n");
    const stored = await putConversationAttachment(
      "test-chat",
      "mock.tsx",
      payload,
    );
    expect(stored).toEqual({
      name: "mock.tsx",
      size: payload.byteLength,
      mimeType: "application/octet-stream",
    });
    expect(
      readFileSync(
        join(conversationsDir, "test-chat", "attachments", "mock.tsx"),
        "utf8",
      ),
    ).toBe("export const x = 1;\n");

    const got = await getConversationAttachment("test-chat", "mock.tsx");
    expect(got.bytes.equals(payload)).toBe(true);
    expect(got.mimeType).toBe("application/octet-stream");

    await putConversationAttachment(
      "test-chat",
      "shot.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(await listConversationAttachments("test-chat")).toEqual([
      {
        name: "mock.tsx",
        size: payload.byteLength,
        mimeType: "application/octet-stream",
      },
      {
        name: "shot.png",
        size: 4,
        mimeType: "image/png",
      },
    ]);

    await removeConversationAttachment("test-chat", "mock.tsx");
    expect(await listConversationAttachments("test-chat")).toEqual([
      {
        name: "shot.png",
        size: 4,
        mimeType: "image/png",
      },
    ]);
    expect(
      existsSync(
        join(conversationsDir, "test-chat", "attachments", "mock.tsx"),
      ),
    ).toBe(false);
  });

  it("keeps the first file and stores a collision under a unique name", async () => {
    const { listConversationAttachments, putConversationAttachment } =
      await loadService();

    const first = await putConversationAttachment(
      "test-chat",
      "foo.tsx",
      Buffer.from("v1"),
    );
    expect(first.name).toBe("foo.tsx");

    const second = await putConversationAttachment(
      "test-chat",
      "foo.tsx",
      Buffer.from("v2"),
    );
    expect(second.name).toBe("foo-2.tsx");
    expect(
      readFileSync(
        join(conversationsDir, "test-chat", "attachments", "foo.tsx"),
        "utf8",
      ),
    ).toBe("v1");
    expect(
      readFileSync(
        join(conversationsDir, "test-chat", "attachments", "foo-2.tsx"),
        "utf8",
      ),
    ).toBe("v2");
    expect(
      (await listConversationAttachments("test-chat")).map((a) => a.name),
    ).toEqual(["foo-2.tsx", "foo.tsx"]);
  });

  it("refuses oversize payloads", async () => {
    const { putConversationAttachment } = await loadService();
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    await expect(
      putConversationAttachment("test-chat", "big.bin", bytes),
    ).rejects.toThrow(/limit/i);
  });

  it("refuses unknown conversation ids", async () => {
    const { putConversationAttachment } = await loadService();
    await expect(
      putConversationAttachment("ghost", "x.txt", Buffer.from("nope")),
    ).rejects.toThrow(/unknown conversation/);
  });
});
