// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_COPY } from "../lib/backup-surface";
import type { BackupResponse } from "../api/queries";
import { AppSettingsPage } from "./app-settings-page";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const REMOTE = "git@github.com:me/tracker-backup.git";
const LAST_PUSH = "2026-08-30T19:04:11.000Z";

function backupResponse(
  overrides: {
    remote?: string | null;
    enabled?: boolean;
    state?: BackupResponse["status"]["state"];
    lastSuccessAt?: string | null;
    error?: string | null;
  } = {},
): BackupResponse {
  return {
    config: {
      remote: overrides.remote === undefined ? REMOTE : overrides.remote,
      enabled: overrides.enabled ?? true,
    },
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

function mountPage(): {
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
        <AppSettingsPage />
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

function stubGet(body: BackupResponse): void {
  requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/backup" && (init?.method === undefined || init.method === "GET")) {
      return body;
    }
    throw new Error(`unexpected ${String(path)} ${String(init?.method)}`);
  });
}

function putCalls(): unknown[] {
  return requestMock.mock.calls.filter(
    ([path, init]) =>
      path === "/api/backup" &&
      init &&
      typeof init === "object" &&
      "method" in init &&
      init.method === "PUT",
  );
}

function remoteInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('[data-testid="backup-remote-input"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Missing remote input");
  }
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!nativeInputValueSetter) {
    throw new Error("Missing HTMLInputElement value setter");
  }
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === "Save remote",
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Missing Save remote button");
  }
  return button;
}

let mounted: ReturnType<typeof mountPage> | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((cb) => {
    cb();
  });
  requestMock.mockReset();
});

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
});

describe("AppSettingsPage", () => {
  it("renders the unconfigured invitation without snapshot state", async () => {
    stubGet(
      backupResponse({
        remote: null,
        enabled: false,
        state: "unconfigured",
        lastSuccessAt: null,
        error: null,
      }),
    );
    mounted = mountPage();
    await flush();

    expect(mounted.container.textContent).toContain("App settings");
    expect(mounted.container.textContent).toContain("Disabled");
    expect(mounted.container.textContent).toContain(
      "Enable backup after the remote is saved.",
    );
    expect(mounted.container.textContent).not.toContain("Snapshot state");
    expect(mounted.container.textContent).not.toContain("Last push");
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
    expect(saveButton(mounted.container).disabled).toBe(true);
  });

  it("renders a healthy mirror's last push", async () => {
    stubGet(backupResponse({ state: "healthy", enabled: true }));
    mounted = mountPage();
    await flush();

    expect(mounted.container.textContent).toContain("Enabled");
    expect(mounted.container.textContent).toContain("Snapshot state");
    const time = mounted.container.querySelector(`time[datetime="${LAST_PUSH}"]`);
    expect(time).not.toBeNull();
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
    expect(mounted.container.textContent).not.toContain("Retrying");
    expect(mounted.container.textContent).not.toContain("Diverged");
    expect(mounted.container.textContent).not.toContain("Stale");
  });

  it("renders retrying in the problem treatment with the error verbatim", async () => {
    const error =
      "push failed: authentication required (HTTP 401): invalid deploy key for git@github.com:me/tracker-backup.git";
    stubGet(
      backupResponse({
        state: "retrying",
        error,
        lastSuccessAt: "2026-08-29T14:42:00.000Z",
      }),
    );
    mounted = mountPage();
    await flush();

    expect(mounted.container.textContent).toContain("Retrying");
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(error);
    expect(alert?.textContent).toContain("Pushes retry with backoff");
  });

  it("renders diverged in the problem treatment with the error verbatim", async () => {
    const error =
      "remote store diverged: snapshot at origin/main does not match this machine (expected head a3f9c2e, found 91bd04f)";
    stubGet(
      backupResponse({
        state: "diverged",
        error,
        lastSuccessAt: "2026-08-28T21:05:00.000Z",
      }),
    );
    mounted = mountPage();
    await flush();

    expect(mounted.container.textContent).toContain("Diverged");
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(error);
    expect(alert?.textContent).toContain("will not merge a different store");
  });

  it("renders stale in the problem treatment with its own copy", async () => {
    stubGet(
      backupResponse({
        state: "stale",
        lastSuccessAt: null,
        error: null,
      }),
    );
    mounted = mountPage();
    await flush();

    expect(mounted.container.textContent).toContain("Stale");
    expect(mounted.container.textContent).toContain("Never");
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(STALE_COPY);
    expect(alert?.textContent).toContain("unprotected until a push succeeds");
  });

  it("issues PUT /api/backup when saving a remote", async () => {
    const unconfigured = backupResponse({
      remote: null,
      enabled: false,
      state: "unconfigured",
      lastSuccessAt: null,
      error: null,
    });
    const afterSave = backupResponse({
      remote: REMOTE,
      enabled: false,
      state: "stale",
      lastSuccessAt: null,
      error: null,
    });
    requestMock.mockImplementation(
      async (path: string, init?: { method?: string; body?: unknown }) => {
        if (path !== "/api/backup") {
          throw new Error(`unexpected ${path}`);
        }
        if (init?.method === "PUT") return afterSave;
        return unconfigured;
      },
    );
    mounted = mountPage();
    await flush();

    const input = remoteInput(mounted.container);
    await act(async () => {
      setInputValue(input, REMOTE);
    });
    await flush();

    const save = saveButton(mounted.container);
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
    });
    await flush();

    expect(putCalls()).toHaveLength(1);
    expect(putCalls()[0]?.[1]).toEqual({
      method: "PUT",
      body: { remote: REMOTE, enabled: false },
    });
    expect(mounted.container.textContent).toContain("Snapshot state");
    expect(mounted.container.textContent).toContain(STALE_COPY);
  });
});
