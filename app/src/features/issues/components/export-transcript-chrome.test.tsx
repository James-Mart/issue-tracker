// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import {
  exportSessionMessage,
  exportSessionTitle,
} from "../lib/export-launch";
import {
  EXPORT_REWRITE_COMPOSER_PLACEHOLDER,
  useExportTranscriptChrome,
} from "./export-transcript-chrome";

const query = vi.hoisted(() => ({
  attachments: [] as { name: string }[],
  events: [] as { type: string; status?: string }[],
  transcriptFetched: true,
  transcriptError: false,
}));

const mutate = vi.hoisted(() => vi.fn());

vi.mock("../api/queries", () => ({
  useAttachmentsQuery: () => ({
    data: query.attachments,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
  useConversationTranscriptQuery: () => ({
    data: query.transcriptFetched ? { events: query.events, latestSeq: 1 } : undefined,
    isFetched: query.transcriptFetched,
    isError: query.transcriptError,
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate: (...args: unknown[]) => mutate(...args),
    isPending: false,
  }),
}));

const onRetried = vi.fn();

function ChromeProbe({
  session,
}: {
  session: ChannelSessionListItem;
}) {
  const chrome = useExportTranscriptChrome(
    { id: "auth", title: "Auth hardening" },
    session,
    onRetried,
  );
  return (
    <div>
      <div data-testid="composer-disabled">
        {chrome.composerDisabled ? "yes" : "no"}
      </div>
      <div data-testid="placeholder">
        {chrome.composerDisabledPlaceholder ?? ""}
      </div>
      {chrome.retry}
    </div>
  );
}

const session: ChannelSessionListItem = {
  id: "exp-1",
  title: "Export Auth hardening",
  model: "composer-2.5",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  archived: false,
  activeRun: false,
  awaitingHuman: false,
};

function mount(activeRun: boolean): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ChromeProbe session={{ ...session, activeRun }} />);
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  query.attachments = [];
  query.events = [];
  query.transcriptFetched = true;
  query.transcriptError = false;
  mutate.mockReset();
  onRetried.mockReset();
});

describe("useExportTranscriptChrome", () => {
  it("disables the composer during the first rewrite", () => {
    const container = mount(true);
    expect(container.querySelector('[data-testid="composer-disabled"]')?.textContent).toBe(
      "yes",
    );
    expect(container.querySelector('[data-testid="placeholder"]')?.textContent).toBe(
      EXPORT_REWRITE_COMPOSER_PLACEHOLDER,
    );
    expect(container.querySelector('[data-testid="export-retry"]')).toBeNull();
  });

  it("posts a new export session from Retry", () => {
    query.events = [{ type: "tool_call", status: "error" }];
    mutate.mockImplementation((_body: unknown, opts: { onSuccess?: (result: { id: string }) => void }) => {
      opts.onSuccess?.({ id: "exp-2" });
    });
    const container = mount(false);
    expect(container.querySelector('[data-testid="composer-disabled"]')?.textContent).toBe(
      "no",
    );
    act(() => {
      (container.querySelector('[data-testid="export-retry"]') as HTMLButtonElement).click();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      model: "composer-2.5",
      title: exportSessionTitle("Auth hardening"),
      message: exportSessionMessage("auth"),
    });
    expect(onRetried).toHaveBeenCalledWith({ id: "exp-2" });
  });
});
