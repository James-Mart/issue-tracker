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
    delegations?: DelegationRecord[];
    meta?: Record<string, unknown>;
  } = {},
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
  const delegations = opts.delegations ?? [];
  writeFileSync(
    join(dir, "delegations.jsonl"),
    delegations.map((d) => JSON.stringify(d)).join("\n") +
      (delegations.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecord> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecord {
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
    ...(overrides.parentDelegationId !== undefined
      ? { parentDelegationId: overrides.parentDelegationId }
      : {}),
  };
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
        delegation({
          delegationId: "del-impl",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "a-task",
          parentCallId: "call-impl",
        }),
        delegation({
          delegationId: "del-qa",
          agentId: "agent-qa",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "a-task",
          parentCallId: "call-qa",
          parentDelegationId: "del-impl",
        }),
        delegation({
          delegationId: "del-look",
          agentId: "agent-look",
          role: "ui-look",
          model: "composer-2.5",
          at: AT_GRAND,
          issueId: "a-task",
          parentCallId: "call-look",
          parentDelegationId: "del-qa",
        }),
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

  it("places every depth-one delegation as a direct child of the root", async () => {
    writeConversation("conv-flat", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          issueId: "capture",
          parentCallId: "call-research",
        }),
        delegation({
          delegationId: "del-author",
          agentId: "agent-author",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "capture",
          parentCallId: "call-author",
        }),
      ],
    });

    const runTreeForConversation = await loadRunTree();
    const tree = runTreeForConversation("conv-flat");

    expect(tree.coordinatorLabel).toBe("planning");
    expect(tree.children.map((c) => c.delegationId)).toEqual([
      "del-research",
      "del-author",
    ]);
    expect(tree.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it("keeps a row that is missing issueId in the tree", async () => {
    writeConversation("conv-orphan-issue", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-with-issue",
          agentId: "agent-a",
          role: "research",
          model: "composer-2.5",
          at: AT,
          issueId: "capture",
          parentCallId: "call-a",
        }),
        delegation({
          delegationId: "del-no-issue",
          agentId: "agent-b",
          role: "grill",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-b",
        }),
      ],
    });

    const runTreeForConversation = await loadRunTree();
    const tree = runTreeForConversation("conv-orphan-issue");

    expect(tree.children.map((c) => c.delegationId)).toEqual([
      "del-with-issue",
      "del-no-issue",
    ]);
  });

  it("returns a root with no children when the conversation has no delegations", async () => {
    writeConversation("conv-empty", {
      meta: { issueId: "capture", channel: "planning" },
    });

    const runTreeForConversation = await loadRunTree();
    expect(runTreeForConversation("conv-empty")).toEqual({
      conversationId: "conv-empty",
      coordinatorLabel: "planning",
      children: [],
    });
  });
});
