// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelSessionListItem as session } from "../test/channel-session-list-item";
import { WorkLoopOverviewControl } from "./work-loop-overview-control";

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkLoopOverviewControl", () => {
  it("renders start copy and action", () => {
    const onAction = vi.fn();
    const { container } = mount(
      <WorkLoopOverviewControl
        mode="start"
        actionTestId="implementing-overview-start-session"
        onAction={onAction}
      />,
    );

    expect(container.querySelector('[data-testid="post-rail-work-loop"]')).toBeTruthy();
    expect(container.textContent).toContain("Start work loop");
    expect(container.textContent).toContain(
      "Outstanding work remains — start coordinating from here.",
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders resume copy, session ref, and action", () => {
    const resumeSession = session({
      id: "sess-oauth",
      title: "Implement OAuth callback hardening",
      updatedAt: "2026-09-09T10:00:00.000Z",
    });
    const onAction = vi.fn();
    const { container } = mount(
      <WorkLoopOverviewControl
        mode="resume"
        session={resumeSession}
        actionTestId="implementing-overview-resume-session"
        onAction={onAction}
      />,
    );

    expect(container.textContent).toContain("Resume work loop");
    expect(container.textContent).toContain(
      "Coordinator paused — pick up where it left off.",
    );
    expect(
      container.querySelector('[data-testid="work-loop-session-ref"]')?.textContent,
    ).toContain("sess-oauth");
    expect(
      container.querySelector('[data-testid="work-loop-session-ref"]')?.textContent,
    ).toContain("Implement OAuth callback hardening");
  });
});
