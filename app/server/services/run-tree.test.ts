import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationRecord } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_CHILD = "2026-07-09T14:05:00.000Z";
const AT_GRAND = "2026-07-09T14:10:00.000Z";

let root: string;
let conversationsDir: string;

function writeConversation(
  id: string,
  opts: {
    delegations: DelegationRecord[];
    meta: Record<string, unknown>;
  },
): void {
  const dir = join(conversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test conversation",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
        ...opts.meta,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "delegations.jsonl"),
    opts.delegations.map((d) => `${JSON.stringify(d)}\n`).join(""),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-run-tree-"));
  conversationsDir = join(root, "conversations");
  mkdirSync(conversationsDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", join(root, "issues"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadRunTree() {
  const { runTreeForConversation } = await import("./run-tree.js");
  return runTreeForConversation;
}

describe("runTreeForConversation", () => {
  it("joins a three-level tree by parentDelegationId and labels the coordinator from type", async () => {
    writeConversation("conv-deep", {
      meta: { issueId: "ship-it", channel: "implementing" },
      delegations: [
        {
          delegationId: "del-impl",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "a-task",
          parentCallId: "call-impl",
        },
        {
          delegationId: "del-qa",
          agentId: "agent-qa",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "a-task",
          parentCallId: "call-qa",
          parentDelegationId: "del-impl",
        },
        {
          delegationId: "del-look",
          agentId: "agent-look",
          role: "ui-look",
          model: "composer-2.5",
          at: AT_GRAND,
          issueId: "a-task",
          parentCallId: "call-look",
          parentDelegationId: "del-qa",
        },
      ],
    });

    const runTreeForConversation = await loadRunTree();
    const tree = runTreeForConversation("conv-deep");

    expect(tree).toEqual({
      conversationId: "conv-deep",
      coordinatorLabel: "implementing",
      children: [
        {
          role: "implementor",
          agentId: "agent-impl",
          delegationId: "del-impl",
          parentCallId: "call-impl",
          at: AT,
          children: [
            {
              role: "validator",
              agentId: "agent-qa",
              delegationId: "del-qa",
              parentCallId: "call-qa",
              at: AT_CHILD,
              children: [
                {
                  role: "ui-look",
                  agentId: "agent-look",
                  delegationId: "del-look",
                  parentCallId: "call-look",
                  at: AT_GRAND,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
