// @vitest-environment happy-dom
import { mountThread, threadUi } from "./conversation-thread.test-helpers";
import { describe, expect, it } from "vitest";

describe("ConversationThread transcript load failure", () => {
  it("shows failed/retry UI instead of loading skeletons when historyFailed", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    threadUi.historyErrorMessage = "Request timed out";
    const container = mountThread("conv-1");

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="transcript-retry"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Could not load the transcript.");
    expect(container.textContent).toContain("Request timed out");
  });
});
