// @vitest-environment happy-dom
import {
  forkMutate,
  mountThread,
  renderThread,
  resetThreadMocks,
  setSelectedConversationId,
  threadUi,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

const FORK_LABEL = "Fork conversation from here";

function forkButtons(container: ParentNode): HTMLButtonElement[] {
  return [...container.querySelectorAll(`button[aria-label="${FORK_LABEL}"]`)];
}

describe("ConversationThread assistant meta fork affordance", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("shows one icon-only control per completed turn", () => {
    ({ container, root } = mountThread("conv-1"));

    const buttons = forkButtons(container!);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute("title")).toBe(FORK_LABEL);
      expect(button.textContent).toBe("");
    }
  });

  it("omits the control on the in-flight last turn and keeps it on completed turns above", () => {
    threadUi.runActive = true;
    ({ container, root } = mountThread("conv-1"));

    expect(forkButtons(container!)).toHaveLength(1);
  });

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
    ({ container, root } = mountThread("conv-1"));

    const buttons = forkButtons(container!);
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
    expect(setSelectedConversationId).toHaveBeenCalledWith("conv-forked");
  });

  it("never shows the control on an in-flight turn that still has an assistant", () => {
    threadUi.runActive = true;
    transcriptState.events = [
      {
        type: "prompt",
        text: "Go",
        at: "2026-07-24T00:00:00.000Z",
        seq: 1,
      },
      {
        type: "assistant",
        text: "Streaming",
        at: "2026-07-24T00:00:01.000Z",
        seq: 2,
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(forkButtons(container!)).toHaveLength(0);
    renderThread(root!, "conv-1");
    expect(forkButtons(container!)).toHaveLength(0);
  });
});
