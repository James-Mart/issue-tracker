// @vitest-environment happy-dom
import {
  forkMutate,
  mountThread,
  navigate,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { describe, expect, it } from "vitest";

const FORK_LABEL = "Fork conversation from here";

function forkButtons(container: ParentNode): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${FORK_LABEL}"]`,
    ),
  ];
}

describe("ConversationThread assistant meta fork affordance", () => {
  it("forks at the turn's last event seq when usage trails the assistant, then navigates", () => {
    transcriptState.events = [
      {
        type: "prompt",
        text: "Go",
        at: "2026-07-24T00:00:00.000Z",
        seq: 1,
      },
      {
        type: "assistant",
        text: "Done",
        at: "2026-07-24T00:00:01.000Z",
        seq: 2,
      },
      {
        type: "usage",
        at: "2026-07-24T00:00:02.000Z",
        seq: 3,
        usage: {
          totalTokens: 4,
          inputTokens: 3,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    ];
    forkMutate.mockImplementation((_vars, opts?: { onSuccess?: (created: { id: string }) => void }) => {
      opts?.onSuccess?.({ id: "conv-forked" });
    });
    const container = mountThread("conv-1");

    const buttons = forkButtons(container);
    expect(buttons).toHaveLength(1);

    act(() => {
      buttons[0]!.click();
    });

    expect(forkMutate).toHaveBeenCalledWith(
      { id: "conv-1", seq: 3 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(forkMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ seq: 2 }),
      expect.anything(),
    );
    expect(navigate).toHaveBeenCalledWith("/agents/conv-forked");
  });
});
