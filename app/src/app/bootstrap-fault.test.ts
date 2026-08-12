// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeUnknownError,
  formatBootstrapFaultDetails,
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

  it("describes Error, string, and other values", () => {
    const err = new Error("mount exploded");
    expect(describeUnknownError(err)).toEqual({
      message: "mount exploded",
      stack: err.stack,
    });
    expect(describeUnknownError("bare string")).toEqual({
      message: "bare string",
    });
    expect(describeUnknownError(undefined).message).toBe("undefined");
  });

  it("formats copyable details with URL, time, UA, and stack", () => {
    const error = new Error("SharedWorker failed");
    const details = formatBootstrapFaultDetails(error);
    expect(details).toContain("Issue Tracker bootstrap fault");
    expect(details).toContain("URL: ");
    expect(details).toContain("Time: ");
    expect(details).toContain("User-Agent: ");
    expect(details).toContain("SharedWorker: ");
    expect(details).toContain("Error: SharedWorker failed");
    expect(details).toContain("Stack: ");
  });

  it("names the requests that failed, not just the entry that reported it", () => {
    stubResourceTimings([
      { name: "https://host/src/main.tsx", responseStatus: 200 },
      {
        name: "https://host/src/features/issues/api/keys.ts",
        responseStatus: 0,
        nextHopProtocol: "h3",
      },
      {
        name: "https://host/node_modules/.vite/deps/react.js?v=abc",
        responseStatus: 503,
        nextHopProtocol: "h2",
        transferSize: 0,
      },
    ]);

    const details = formatBootstrapFaultDetails(
      new Error("Script failed to load: https://host/src/main.tsx"),
    );

    expect(details).toContain("Resources: 3 requested, 2 failed");
    expect(details).toContain(
      "Failed resource: status=0 protocol=h3 bytes=0 https://host/src/features/issues/api/keys.ts",
    );
    expect(details).toContain(
      "Failed resource: status=503 protocol=h2 bytes=0 https://host/node_modules/.vite/deps/react.js?v=abc",
    );
  });

  it("counts failing requests beyond the ones it lists", () => {
    stubResourceTimings(
      Array.from({ length: 8 }, (_, index) => ({
        name: `https://host/src/module-${index}.ts`,
        responseStatus: 0,
      })),
    );

    const details = formatBootstrapFaultDetails(new Error("load failed"));

    expect(details).toContain("Resources: 8 requested, 8 failed");
    expect(details.match(/Failed resource:/g)).toHaveLength(5);
    expect(details).toContain("Failed resources not listed: 3");
  });

  it("reports no failures when every request succeeded", () => {
    stubResourceTimings([
      { name: "https://host/src/main.tsx", responseStatus: 200 },
      { name: "https://host/src/app/app.tsx", responseStatus: 304 },
    ]);

    const details = formatBootstrapFaultDetails(new Error("render threw"));

    expect(details).toContain("Resources: 2 requested, 0 failed");
    expect(details).not.toContain("Failed resource:");
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

  it("does not paint a second Fault over the first", () => {
    showBootstrapFault(new Error("first"));
    showBootstrapFault(new Error("second"));
    const messages = [...root().querySelectorAll(".font-mono")].map(
      (el) => el.textContent,
    );
    expect(messages).toEqual(["first"]);
  });

  it("mountClient catches a synchronous throw and paints Fault", () => {
    mountClient(() => {
      throw new Error("initial render threw");
    });
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    expect(root().textContent).toContain("initial render threw");
    expect(root().textContent).not.toBe("");
  });

  it("mountClient leaves a successful mount alone", () => {
    mountClient(() => {
      root().innerHTML = "<main>mounted</main>";
    });
    expect(root().textContent).toBe("mounted");
    expect(root().querySelector("[data-bootstrap-fault]")).toBeNull();
  });

  it("window error on an empty root paints Fault", async () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("window boom"),
        message: "window boom",
      }),
    );
    await flushFaultSchedule();
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    expect(root().textContent).toContain("window boom");
  });

  it("window error does not blank a usable shell", async () => {
    root().innerHTML = "<main>shell</main>";
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("ignored"),
        message: "ignored",
      }),
    );
    await flushFaultSchedule();
    expect(root().querySelector("[data-bootstrap-fault]")).toBeNull();
    expect(root().textContent).toBe("shell");
  });

  it("unhandled rejection on an empty root paints Fault", async () => {
    const reason = new Error("rejected during mount");
    const event = new Event("unhandledrejection");
    Object.assign(event, { reason });
    window.dispatchEvent(event);
    await flushFaultSchedule();
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    expect(root().textContent).toContain("rejected during mount");
  });

  it("paints a fault queued before handlers were installed", () => {
    resetBootstrapFaultHandlingForTests();
    window.__bootstrapFaultQueue = [new Error("queued before install")];
    installBootstrapFaultHandling();
    expect(root().querySelector("[data-bootstrap-fault]")).not.toBeNull();
    expect(root().textContent).toContain("queued before install");
  });

  it("ignores non-script resource errors on an empty root", async () => {
    const img = document.createElement("img");
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: img });
    window.dispatchEvent(event);
    await flushFaultSchedule();
    expect(root().querySelector("[data-bootstrap-fault]")).toBeNull();
    expect(root().childElementCount).toBe(0);
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

  it("does not reload for a fault with no failed optimized dep", async () => {
    stubResourceTimings([
      { name: "https://host/src/main.tsx", responseStatus: 404 },
      {
        name: "https://host/node_modules/.vite/deps/react.js?v=abc",
        responseStatus: 200,
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { href: "https://host/", reload });

    showBootstrapFault(new Error("Script failed to load: /src/main.tsx"));
    await flushFaultSchedule();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("Copy details writes the diagnostic payload to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: navigator.userAgent,
      clipboard: { writeText },
    });
    showBootstrapFault(new Error("copy me"));
    const button = root().querySelector("button");
    expect(button).not.toBeNull();
    button!.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const payload = writeText.mock.calls[0]?.[0] as string;
    expect(payload).toContain("Error: copy me");
    expect(payload).toContain("Issue Tracker bootstrap fault");
    await vi.waitFor(() => {
      expect(button!.textContent).toBe("Copied");
    });
  });
});
