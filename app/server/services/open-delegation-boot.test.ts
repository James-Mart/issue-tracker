import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-25T12:00:00.000Z";

let issuesRoot: string;
let issuesDir: string;

function seedPlatformIssue(): void {
  mkdirSync(join(issuesDir, "platform"), { recursive: true });
  writeFileSync(
    join(issuesDir, "platform", "issue.json"),
    JSON.stringify({
      id: "platform",
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
}

async function loadModules() {
  const { refreshStorePathsFromEnv } = await import("../config.js");
  refreshStorePathsFromEnv();
  const conversations = await import("./conversations.js");
  const boot = await import("./open-delegation-boot.js");
  return { ...conversations, ...boot };
}

beforeEach(() => {
  vi.resetModules();
  issuesRoot = mkdtempSync(join(tmpdir(), "open-del-boot-"));
  issuesDir = join(issuesRoot, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedPlatformIssue();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(issuesRoot, { recursive: true, force: true });
});

describe("open delegation boot reconciliation", () => {
  it("closes every open delegation with host-process-died before listen", async () => {
    const {
      createConversation,
      appendDelegation,
      appendDelegationEnd,
      readDelegations,
      closeOpenDelegationsAtBoot,
    } = await loadModules();

    const meta = await createConversation({
      title: "Boot close",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-open-1",
      agentId: "agent-1",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-open-2",
      agentId: "agent-2",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-closed",
      agentId: "agent-3",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegationEnd(meta.id, {
      delegationId: "del-closed",
      status: "completed",
    });

    const beforeClose = Date.now();
    await closeOpenDelegationsAtBoot();
    const afterClose = Date.now();

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(3);

    const openOne = records.find((r) => r.delegationId === "del-open-1");
    const openTwo = records.find((r) => r.delegationId === "del-open-2");
    const closed = records.find((r) => r.delegationId === "del-closed");

    for (const record of [openOne, openTwo]) {
      expect(record?.end).toMatchObject({
        status: "error",
        failureClass: "host-process-died",
      });
      const endedAtMs = Date.parse(record!.end!.endedAt);
      expect(endedAtMs).toBeGreaterThanOrEqual(beforeClose);
      expect(endedAtMs).toBeLessThanOrEqual(afterClose);
    }

    expect(closed?.end).toMatchObject({
      status: "completed",
    });
    expect(closed?.end).not.toHaveProperty("failureClass");
  });
});
