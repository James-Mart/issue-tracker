// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mountThread, threadUi } from "./conversation-thread.test-helpers";

describe("ConversationThread pending message", () => {
  it("shows not-sent state when pending coexists with no active run", () => {
    threadUi.pendingText = "never sent";
    threadUi.runActive = false;
    const container = mountThread("conv-1");

    const row = container.querySelector('[data-testid="pending-message-row"]');
    expect(row!.textContent).toContain("Not sent");
    expect(row!.textContent).toContain(
      "The run ended before this message could send.",
    );
    expect(
      container.querySelector('[data-testid="pending-send-now"]'),
    ).toBeTruthy();
  });
});
