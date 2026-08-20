// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/errors";
import type { HealthResponse } from "../api/queries";
import {
  RESTART_FAILURE_MESSAGE,
  RESTART_PENDING_MESSAGE,
  RESTART_POLL_MS,
  RESTART_UNSUPPORTED_REASON,
  RESTART_WAIT_MS,
  RestartControl,
} from "./restart-control";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

let health: HealthResponse;
let healthError: Error | null;
let restartError: Error | null;

function healthBody(
  overrides: Partial<HealthResponse> = {},
): HealthResponse {
  return {
    bootId: "boot-1",
    startedAt: "2026-08-20T00:00:00.000Z",
    restartSupported: true,
    ...overrides,
  };
}

function mountControl(): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <RestartControl />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  return { container, root, client, invalidateSpy };
}

function unmount(mounted: {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}): void {
  act(() => {
    mounted.root.unmount();
  });
  mounted.client.clear();
  mounted.container.remove();
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function button(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[data-testid="restart-control"]',
  ) as HTMLButtonElement;
}

function status(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="restart-control-status"]');
}

function postCalls(): unknown[][] {
  return requestMock.mock.calls.filter(([path]) => path === "/api/restart");
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  health = healthBody();
  healthError = null;
  restartError = null;
  requestMock.mockImplementation(
    async (path: string) => {
      if (path === "/api/health") {
        if (healthError) throw healthError;
        return health;
      }
      if (path === "/api/restart") {
        if (restartError) throw restartError;
        return { bootId: health.bootId };
      }
      throw new Error(`unexpected ${String(path)}`);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("RestartControl", () => {
  it("is disabled with its tooltip when restart is not supported", async () => {
    health = healthBody({ restartSupported: false });
    const mounted = mountControl();
    await flush();

    const control = button(mounted.container);
    expect(control.disabled).toBe(true);
    expect(status(mounted.container)?.textContent).toBe(
      RESTART_UNSUPPORTED_REASON,
    );

    act(() => {
      control.parentElement?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true }),
      );
    });
    await flush();
    expect(document.body.textContent).toContain(RESTART_UNSUPPORTED_REASON);

    unmount(mounted);
  });

  it("posts once and shows pending when restart is supported", async () => {
    const mounted = mountControl();
    await flush();

    act(() => {
      button(mounted.container).click();
    });
    await flush();

    expect(postCalls()).toHaveLength(1);
    expect(status(mounted.container)?.textContent).toBe(
      RESTART_PENDING_MESSAGE,
    );
    expect(button(mounted.container).getAttribute("aria-busy")).toBe("true");

    unmount(mounted);
  });

  it("clears pending once health reports a changed bootId", async () => {
    const mounted = mountControl();
    await flush();

    act(() => {
      button(mounted.container).click();
    });
    await flush();
    expect(status(mounted.container)?.textContent).toBe(
      RESTART_PENDING_MESSAGE,
    );

    health = healthBody({ bootId: "boot-2" });
    await advance(RESTART_POLL_MS);
    await flush();

    expect(status(mounted.container)).toBeNull();
    expect(button(mounted.container).disabled).toBe(false);
    expect(mounted.invalidateSpy).toHaveBeenCalled();

    unmount(mounted);
  });

  it("keeps pending when health still reports the same bootId", async () => {
    const mounted = mountControl();
    await flush();

    act(() => {
      button(mounted.container).click();
    });
    await flush();

    await advance(RESTART_POLL_MS);
    await flush();
    await advance(RESTART_POLL_MS);
    await flush();

    expect(status(mounted.container)?.textContent).toBe(
      RESTART_PENDING_MESSAGE,
    );
    expect(postCalls()).toHaveLength(1);
    expect(mounted.invalidateSpy).not.toHaveBeenCalled();

    unmount(mounted);
  });

  it("shows a failure state after 30 seconds without a new bootId", async () => {
    const mounted = mountControl();
    await flush();

    act(() => {
      button(mounted.container).click();
    });
    await flush();

    healthError = new ApiError("down", 502);
    await advance(RESTART_WAIT_MS);
    await flush();

    const failure = status(mounted.container)?.textContent ?? "";
    expect(failure).toBe(RESTART_FAILURE_MESSAGE);
    expect(failure.toLowerCase()).not.toContain("terminal");
    expect(failure.toLowerCase()).not.toContain("serve");
    expect(status(mounted.container)?.textContent).not.toBe(
      RESTART_PENDING_MESSAGE,
    );

    unmount(mounted);
  });
});
