import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  agentsDir,
  cwd,
  holdAfterStream,
  loadNestedRunPublishModules,
  setupDelegateToolTest,
  setupNestedRunPublishTest,
  storeDir,
  teardownDelegateToolTest,
  teardownNestedRunPublishTest,
  waitForHandleSend,
  writeAgent,
  writeNestedRunIssue as writeIssue,
} from "./delegate-tool.fixtures.js";

const S1_WORKTREE = "/tmp/issue-tracker-worktrees-test/platform/s1";

function writeRole(name: string, exclusive: boolean): void {
  writeAgent(
    `${name}.md`,
    `---
name: ${name}
model: composer-2.5
description: ${name} for worktree lease tests.
${exclusive ? "worktree: exclusive\n" : ""}---

You are ${name}.`,
  );
}

async function loadTools(sdk: ReturnType<typeof createFakeAgentSdk>) {
  const { createDelegateCustomTools } = await loadNestedRunPublishModules();
  return createDelegateCustomTools({ sdk, cwd, storeDir, agentsDir }).delegate!;
}

beforeEach(() => {
  setupDelegateToolTest();
  setupNestedRunPublishTest();
  writeRole("implementor", true);
  writeRole("git", true);
  writeRole("reviewer", false);
  writeIssue("s1", {
    kind: "story",
    title: "Story one",
    partOf: "platform",
    order: 0,
    worktreePath: S1_WORKTREE,
  });
  writeIssue("s2", { kind: "story", title: "Story two", partOf: "platform", order: 1 });
  writeIssue("t1a", { kind: "task", title: "Task 1a", partOf: "s1", order: 0 });
  writeIssue("t1b", { kind: "task", title: "Task 1b", partOf: "s1", order: 1 });
  writeIssue("t2", { kind: "task", title: "Task 2", partOf: "s2", order: 0 });
});

afterEach(() => {
  teardownNestedRunPublishTest();
  teardownDelegateToolTest();
});

describe("delegate worktree lease", () => {
  it("refuses a second implementor in the same Story worktree while the first runs", async () => {
    const { hold, release } = holdAfterStream();
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const delegate = await loadTools(fake);

    const first = delegate.execute(
      { role: "implementor", prompt: "go", issueId: "t1a" },
      {},
    );
    await waitForHandleSend(fake, 0);

    await expect(
      delegate.execute({ role: "implementor", prompt: "go", issueId: "t1b" }, {}),
    ).rejects.toThrow(
      `delegate: worktree ${S1_WORKTREE} is in use by implementor for "t1a"`,
    );
    await expect(
      delegate.execute({ role: "git", prompt: "start", issueId: "s1" }, {}),
    ).rejects.toThrow(/is in use by implementor for "t1a"/);
    expect(fake.created).toHaveLength(1);

    release();
    await first;
  });

  it("lets the holding implementor fan out reviewers and its own git agent", async () => {
    const { hold, release } = holdAfterStream();
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const delegate = await loadTools(fake);

    const implementor = delegate.execute(
      { role: "implementor", prompt: "go", issueId: "t1a" },
      {},
    );
    await waitForHandleSend(fake, 0);
    const nested = fake.created[0]!.customTools!.delegate!;

    const reviewers = [
      nested.execute({ role: "reviewer", prompt: "review", issueId: "t1a" }, {}),
      nested.execute({ role: "reviewer", prompt: "review", issueId: "t1a" }, {}),
    ];
    await waitForHandleSend(fake, 1);
    await waitForHandleSend(fake, 2);
    const git = nested.execute(
      { role: "git", prompt: "record commit", issueId: "t1a" },
      {},
    );
    await waitForHandleSend(fake, 3);

    expect(fake.created).toHaveLength(4);
    release();
    await Promise.all([implementor, ...reviewers, git]);
  });
});
