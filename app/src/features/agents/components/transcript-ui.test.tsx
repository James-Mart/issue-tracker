// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptToolCall } from "./transcript-ui";

function mountToolCall(
  props: ComponentProps<typeof TranscriptToolCall>,
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TranscriptToolCall {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TranscriptToolCall", () => {
  it("keeps a completed call collapsed until the summary is toggled", () => {
    const { container } = mountToolCall({
      callId: "call-1",
      name: "Shell",
      status: "completed",
      args: { command: "npm test" },
      result: { exitCode: 0 },
    });

    const row = container.querySelector("[data-call-id='call-1']");
    expect(row).toBeTruthy();
    expect((row as HTMLDetailsElement).open).toBe(false);

    const summary = row!.querySelector("summary");
    expect(summary!.textContent).toContain("npm test");
    expect(summary!.textContent).not.toContain("exitCode");

    act(() => {
      (summary as HTMLElement).click();
    });

    expect((row as HTMLDetailsElement).open).toBe(true);
    expect(container.textContent).toContain('"exitCode"');
  });

  it("renders an errored call expanded with its result visible", () => {
    const { container } = mountToolCall({
      callId: "call-err",
      name: "Read",
      status: "error",
      args: { path: "/missing" },
      result: "ENOENT: no such file",
    });

    const row = container.querySelector("[data-call-id='call-err']");
    expect(row).toBeTruthy();
    expect((row as HTMLDetailsElement).open).toBe(true);
    expect(container.textContent).toContain("ENOENT: no such file");
  });

  it("shows one-line summary with label and detail at compact density", () => {
    const { container } = mountToolCall({
      callId: "call-compact",
      name: "Grep",
      status: "running",
      args: { pattern: "TranscriptToolCall" },
      density: "compact",
    });

    const summary = container.querySelector("summary");
    expect(summary).toBeTruthy();
    expect(summary!.textContent).toContain("Grep");
    expect(summary!.textContent).toContain("TranscriptToolCall");
    expect(summary!.textContent).not.toContain("call-compact");
  });
});
