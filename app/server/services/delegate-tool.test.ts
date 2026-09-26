import { afterEach, beforeEach, describe, it } from "vitest";
import { agentFailureClassSchema } from "../schemas/conversation.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  expectResultMatchesOutputSchema,
  expectToolAnnotations,
} from "./custom-tool-metadata.test-helpers.js";
import { createDelegateCustomTools } from "./delegate-tool.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  cwd,
  setupDelegateToolTest,
  storeDir,
  teardownDelegateToolTest,
} from "./delegate-tool.fixtures.js";

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("delegate custom tool metadata", () => {
  it("advertises delegate and delegations annotations and output schemas", () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: "conv-meta",
    });

    expectToolAnnotations(customTools.delegate!, {
      title: "Delegate to role",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expectToolAnnotations(customTools.delegations!, {
      title: "List delegations",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    expectResultMatchesOutputSchema(customTools.delegate!, {
      ok: true,
      agentId: "agent-1",
      reply: "done",
    });
    for (const failureClass of agentFailureClassSchema.options) {
      expectResultMatchesOutputSchema(customTools.delegate!, {
        ok: false,
        failureClass,
        isRetryable: failureClass === "stalled-before-first-token",
        message: "nested run failed",
        agentId: "agent-1",
      });
    }

    expectResultMatchesOutputSchema(customTools.delegations!, {
      delegations: [],
    });
    expectResultMatchesOutputSchema(customTools.delegations!, {
      root: { agentId: "root-1" },
      delegations: [
        {
          delegationId: "d-1",
          agentId: "agent-1",
          role: "issue-tracker-git",
          model: "composer-2.5",
          at: "2026-01-01T00:00:00.000Z",
          parentDelegationId: "parent-1",
          end: {
            status: "error",
            endedAt: "2026-01-01T00:01:00.000Z",
            failureClass: "auth",
          },
        },
      ],
    });
  });
});
