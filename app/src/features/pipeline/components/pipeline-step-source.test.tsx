// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PipelineStepSourcePanel,
  PipelineStepSourceSheet,
} from "./pipeline-step-source";

vi.mock("@/lib/ws/transport", () => ({
  subscribeTopic: () => () => {},
}));

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function mountWithClient(ui: React.ReactNode): { root: Root; client: QueryClient } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  act(() => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return { root, client };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function sheetContent(): HTMLElement {
  const sheet = document.querySelector(
    '[data-testid="pipeline-step-source-sheet"]',
  );
  if (!(sheet instanceof HTMLElement)) {
    throw new Error("Missing step source sheet");
  }
  return sheet;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((cb) => {
    cb();
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PipelineStepSourceSheet", () => {
  it("renders a top-anchored sheet with a bottom handle and visible header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          source: "agents/issue-tracker-implementor.md",
          markdown: "Sheet body prose.",
        }),
      ),
    );

    mountWithClient(
      <PipelineStepSourceSheet
        stepId="implement"
        title="Implementor"
        source="agents/issue-tracker-implementor.md"
        onDismiss={() => {}}
      />,
    );
    await flush();

    const sheet = sheetContent();
    expect(sheet.className).toMatch(/\btop-0\b/);
    expect(sheet.className).toMatch(/\bslide-in-from-top\b/);

    const header = sheet.querySelector(
      '[data-testid="pipeline-step-source-header"]',
    );
    expect(header).toBeTruthy();
    expect(header?.textContent).toContain("Source");
    expect(header?.textContent).toContain("Implementor");
    expect(header?.textContent).toContain("agents/issue-tracker-implementor.md");

    const [close] = Array.from(sheet.querySelectorAll("button"));
    expect(close.className).toMatch(/\bmt-auto\b/);
    expect(close.querySelector('[aria-hidden]')?.className).toMatch(/\bw-11\b/);

    expect(sheet.textContent).toContain("Sheet body prose.");
    expect(sheet.querySelectorAll("h2")).toHaveLength(1);
  });
});

describe("PipelineStepSourcePanel", () => {
  it("renders the desktop aside with its inline header unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          source: "agents/issue-tracker-implementor.md",
          markdown: "Panel body prose.",
        }),
      ),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = testQueryClient();
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <PipelineStepSourcePanel
            stepId="implement"
            title="Implementor"
            source="agents/issue-tracker-implementor.md"
            onDismiss={() => {}}
          />
        </QueryClientProvider>,
      );
    });
    await flush();

    const panel = container.querySelector(
      '[data-testid="pipeline-step-source-panel"]',
    );
    expect(panel).toBeTruthy();
    expect(
      panel?.querySelector('[data-testid="pipeline-step-source-header"]'),
    ).toBeNull();
    expect(panel?.querySelector("h2")?.textContent).toBe("Implementor");
    expect(panel?.textContent).toContain("agents/issue-tracker-implementor.md");
    expect(panel?.textContent).toContain("Panel body prose.");
    expect(panel?.querySelector('[aria-label="Close"]')).toBeTruthy();
  });
});
