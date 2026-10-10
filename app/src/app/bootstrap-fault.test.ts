// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installBootstrapFaultHandling,
  mountClient,
  resetBootstrapFaultHandlingForTests,
  showBootstrapFault,
} from "./bootstrap-fault";

function root(): HTMLElement {
  const el = document.getElementById("root");
  if (!el) throw new Error("missing #root");
  return el;
}

function flushFaultSchedule(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type StubTiming = {
  name: string;
  responseStatus: number;
  nextHopProtocol?: string;
  transferSize?: number;
};

function stubResourceTimings(entries: StubTiming[]): void {
  const timings = entries.map((entry) => ({
    nextHopProtocol: "h2",
    transferSize: 0,
    ...entry,
  }));
  vi.stubGlobal("performance", {
    ...performance,
    getEntriesByType: (type: string) => (type === "resource" ? timings : []),
  });
}

describe("bootstrap Fault surface", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    installBootstrapFaultHandling();
  });

  afterEach(() => {
    resetBootstrapFaultHandlingForTests();
    delete window.__bootstrapFaultQueue;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("paints Fault into an empty #root instead of leaving it blank", () => {
    showBootstrapFault(new Error("createRoot failed"));
    const host = root();
    expect(host.querySelector("[data-bootstrap-fault]")).not.toBeNull();
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Fault");
    expect(alert?.textContent).toContain("The app failed to start.");
    expect(alert?.textContent).toContain("createRoot failed");
    expect(
      host.querySelector("button")?.textContent,
    ).toBe("Copy details");
  });

  it("does not replace a usable shell already in #root", () => {
    root().innerHTML = "<main>Issue Tracker</main>";
    showBootstrapFault(new Error("late error"));
    expect(root().querySelector("[data-bootstrap-fault]")).toBeNull();
    expect(root().textContent).toBe("Issue Tracker");
  });

  it("mountClient catches a synchronous throw and paints Fault", () => {
    mountClient(() => {
      throw new Error("initial render threw");
    });
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    expect(root().textContent).toContain("initial render threw");
    expect(root().textContent).not.toBe("");
  });

  it("replaces cached optimized deps and reloads when a dep chunk 404s", async () => {
    stubResourceTimings([
      { name: "https://host/src/main.tsx", responseStatus: 200 },
      {
        name: "https://host/node_modules/.vite/deps/react.js?v=abc",
        responseStatus: 200,
      },
      {
        name: "https://host/node_modules/.vite/deps/chunk-GONE.js?v=abc",
        responseStatus: 404,
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { href: "https://host/", reload });

    showBootstrapFault(new Error("Script failed to load: /src/main.tsx"));

    // Fault paints either way; the repair is what gets the shell back.
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        "https://host/node_modules/.vite/deps/react.js?v=abc",
        { cache: "reload" },
      ],
      [
        "https://host/node_modules/.vite/deps/chunk-GONE.js?v=abc",
        { cache: "reload" },
      ],
    ]);
  });

  it("bounds repair passes per tab session so a repeat failure cannot loop", async () => {
    stubResourceTimings([
      {
        name: "https://host/node_modules/.vite/deps/chunk-GONE.js?v=abc",
        responseStatus: 404,
      },
    ]);
    const reload = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(undefined));
    vi.stubGlobal("location", { href: "https://host/", reload });

    for (let load = 1; load <= 3; load += 1) {
      document.body.innerHTML = '<div id="root"></div>';
      showBootstrapFault(new Error(`load ${load} hit the same missing chunk`));
      await vi.waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(load);
      });
    }

    document.body.innerHTML = '<div id="root"></div>';
    showBootstrapFault(new Error("still failing after three passes"));
    await flushFaultSchedule();
    expect(reload).toHaveBeenCalledTimes(3);
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
  });
});
