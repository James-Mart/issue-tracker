// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  backupChipAccessibleLabel,
  STALE_COPY,
} from "@/features/app-settings/lib/backup-surface";
import type { BackupResponse } from "@/features/app-settings/api/queries";
import { TopBar } from "./top-bar";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: [], derived: {} },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./restart-control", () => ({
  RestartControl: () => null,
}));

vi.mock("../hooks/use-route-project-id", () => ({
  useRouteProjectId: () => null,
}));

vi.mock("../store/use-cockpit-launch-store", () => ({
  useCockpitLaunchStore: (selector: (s: { pending: boolean; ack: null }) => unknown) =>
    selector({ pending: false, ack: null }),
  useCockpitLaunchIssuesSync: () => {},
}));

const REMOTE = "git@github.com:me/tracker-backup.git";
const LAST_PUSH = "2026-08-30T17:04:11.000Z";

function backupResponse(
  overrides: {
    state?: BackupResponse["status"]["state"];
    lastSuccessAt?: string | null;
    error?: string | null;
  } = {},
): BackupResponse {
  return {
    config: { remote: REMOTE, enabled: true },
    status: {
      state: overrides.state ?? "healthy",
      lastSuccessAt:
        overrides.lastSuccessAt === undefined
          ? LAST_PUSH
          : overrides.lastSuccessAt,
      error: overrides.error === undefined ? null : overrides.error,
    },
  };
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function mountTopBar(): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SidebarProvider>
            <TooltipProvider delayDuration={0}>
              <TopBar />
            </TooltipProvider>
          </SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root, client };
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
  });
}

function stubBackup(body: BackupResponse): void {
  requestMock.mockImplementation(async (path: string) => {
    if (path === "/api/backup") return body;
    if (path === "/api/health") {
      return {
        bootId: "boot-1",
        startedAt: "2026-08-20T00:00:00.000Z",
        restartSupported: false,
      };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function backupChip(container: HTMLElement): HTMLAnchorElement {
  const chip = container.querySelector('[data-testid="backup-chip"]');
  if (!(chip instanceof HTMLAnchorElement)) {
    throw new Error("Missing backup chip link");
  }
  return chip;
}

let mounted: ReturnType<typeof mountTopBar> | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((cb) => {
    cb();
  });
  requestMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T19:04:11.000Z"));
});

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  vi.useRealTimers();
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
});

describe("TopBar backup chip", () => {
  it("maps healthy to the ordinary chip treatment", async () => {
    stubBackup(backupResponse({ state: "healthy" }));
    mounted = mountTopBar();
    await flush();

    const chip = backupChip(mounted.container);
    expect(chip.getAttribute("data-backup-state")).toBe("healthy");
    expect(chip.getAttribute("data-backup-warning")).toBe("false");
    expect(chip.className).not.toContain("--warning");
    expect(chip.textContent).toContain("2h");
  });

  it("maps retrying to the ordinary chip treatment", async () => {
    const error = "push failed: authentication required (HTTP 401)";
    stubBackup(
      backupResponse({
        state: "retrying",
        error,
        lastSuccessAt: "2026-08-29T14:42:00.000Z",
      }),
    );
    mounted = mountTopBar();
    await flush();

    const chip = backupChip(mounted.container);
    expect(chip.getAttribute("data-backup-state")).toBe("retrying");
    expect(chip.getAttribute("data-backup-warning")).toBe("false");
    expect(chip.className).not.toContain("--warning");
    expect(chip.getAttribute("aria-label")).toBe(error);
  });

  it("maps stale to the warning chip treatment without a dismiss control", async () => {
    stubBackup(
      backupResponse({
        state: "stale",
        lastSuccessAt: "2026-08-28T19:04:11.000Z",
        error: null,
      }),
    );
    mounted = mountTopBar();
    await flush();

    const chip = backupChip(mounted.container);
    expect(chip.getAttribute("data-backup-state")).toBe("stale");
    expect(chip.getAttribute("data-backup-warning")).toBe("true");
    expect(chip.className).toContain("--warning");
    expect(chip.querySelector("button")).toBeNull();
    expect(chip.getAttribute("aria-label")).toBe(STALE_COPY);
  });

  it("maps diverged to the warning chip treatment without a dismiss control", async () => {
    const error =
      "remote store diverged: snapshot at origin/main does not match this machine";
    stubBackup(
      backupResponse({
        state: "diverged",
        error,
        lastSuccessAt: "2026-08-28T21:05:00.000Z",
      }),
    );
    mounted = mountTopBar();
    await flush();

    const chip = backupChip(mounted.container);
    expect(chip.getAttribute("data-backup-state")).toBe("diverged");
    expect(chip.getAttribute("data-backup-warning")).toBe("true");
    expect(chip.className).toContain("--warning");
    expect(chip.querySelector("button")).toBeNull();
    expect(chip.getAttribute("aria-label")).toBe(error);
  });

  it("carries the full fact in the accessible label for healthy state", async () => {
    stubBackup(backupResponse({ state: "healthy" }));
    mounted = mountTopBar();
    await flush();

    const chip = backupChip(mounted.container);
    const label = backupChipAccessibleLabel(
      "healthy",
      LAST_PUSH,
      null,
    );
    expect(chip.getAttribute("aria-label")).toBe(label);
    expect(chip.getAttribute("title")).toBe(label);
    expect(label).toContain("Last backup push:");
  });

  it("links the chip to settings", async () => {
    stubBackup(backupResponse({ state: "healthy" }));
    mounted = mountTopBar();
    await flush();

    expect(backupChip(mounted.container).getAttribute("href")).toBe("/settings");
  });

  it("omits the chip when backup is unconfigured", async () => {
    stubBackup({
      config: { remote: null, enabled: false },
      status: {
        state: "unconfigured",
        lastSuccessAt: null,
        error: null,
      },
    });
    mounted = mountTopBar();
    await flush();

    expect(
      mounted.container.querySelector('[data-testid="backup-chip"]'),
    ).toBeNull();
  });
});
