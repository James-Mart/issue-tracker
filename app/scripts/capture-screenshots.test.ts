import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BASE_URL,
  loadDriverModule,
  parseArgs,
  pipelineRunsPageReady,
  resolveDefaultBaseUrl,
  validateScreenshotOptions,
} from "./capture-screenshots.js";

const scriptPath = fileURLToPath(new URL("./capture-screenshots.ts", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDefaultBaseUrl", () => {
  it("defaults to localhost:8060 when AGENT_STACK_BASE_URL is unset", () => {
    expect(resolveDefaultBaseUrl({})).toBe(DEFAULT_BASE_URL);
  });

  it("uses AGENT_STACK_BASE_URL when set", () => {
    expect(
      resolveDefaultBaseUrl({ AGENT_STACK_BASE_URL: "http://127.0.0.1:41002" }),
    ).toBe("http://127.0.0.1:41002");
  });

  it("strips a trailing slash from AGENT_STACK_BASE_URL", () => {
    expect(
      resolveDefaultBaseUrl({ AGENT_STACK_BASE_URL: "http://127.0.0.1:41002/" }),
    ).toBe("http://127.0.0.1:41002");
  });
});

describe("parseArgs base URL", () => {
  it("picks up AGENT_STACK_BASE_URL from the environment", () => {
    vi.stubEnv("AGENT_STACK_BASE_URL", "http://127.0.0.1:42002");
    expect(parseArgs(["--list"]).baseUrl).toBe("http://127.0.0.1:42002");
  });

  it("lets --base-url override AGENT_STACK_BASE_URL", () => {
    vi.stubEnv("AGENT_STACK_BASE_URL", "http://127.0.0.1:42002");
    expect(parseArgs(["--base-url", "http://127.0.0.1:43002", "--list"]).baseUrl).toBe(
      "http://127.0.0.1:43002",
    );
  });

  it("falls back to 8060 when env is unset", () => {
    delete process.env.AGENT_STACK_BASE_URL;
    expect(parseArgs(["--list"]).baseUrl).toBe(DEFAULT_BASE_URL);
  });
});

describe("parseArgs --driver", () => {
  it("accepts an absolute driver path", () => {
    expect(parseArgs(["--driver", "/tmp/reach.mjs"]).driver).toBe("/tmp/reach.mjs");
  });

  it("rejects a relative driver path", () => {
    expect(() => parseArgs(["--driver", "reach.mjs"])).toThrow(
      "--driver path must be absolute",
    );
  });

  it("rejects a missing driver value", () => {
    expect(() => parseArgs(["--driver"])).toThrow("--driver requires an absolute path");
  });

  it("rejects driver combined with a positional target", () => {
    expect(() => parseArgs(["--driver", "/tmp/reach.mjs", "/"])).toThrow(
      "--driver cannot be combined with path or dialog targets",
    );
  });

  it("rejects driver combined with --all", () => {
    expect(() => parseArgs(["--driver", "/tmp/reach.mjs", "--all"])).toThrow(
      "--driver cannot be combined with --all",
    );
  });
});

describe("validateScreenshotOptions", () => {
  it("allows driver-only options", () => {
    expect(() =>
      validateScreenshotOptions({
        baseUrl: DEFAULT_BASE_URL,
        out: "/tmp/out",
        project: null,
        theme: "dark",
        viewport: { width: 1440, height: 900 },
        all: false,
        list: false,
        driver: "/tmp/reach.mjs",
        targets: [],
      }),
    ).not.toThrow();
  });
});

describe("loadDriverModule", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "screenshot-driver-"));

  afterEach(() => {
    for (const name of ["valid.mjs", "missing-reach.mjs"]) {
      const path = join(tempDir, name);
      if (existsSync(path)) rmSync(path);
    }
  });

  it("loads a module that exports reach", async () => {
    const driverPath = join(tempDir, "valid.mjs");
    writeFileSync(
      driverPath,
      "export async function reach(page) { await page.evaluate(() => document.title); }\n",
    );
    const reach = await loadDriverModule(driverPath);
    expect(typeof reach).toBe("function");
  });

  it("rejects a module without reach", async () => {
    const driverPath = join(tempDir, "missing-reach.mjs");
    writeFileSync(driverPath, "export const notReach = 1;\n");
    await expect(loadDriverModule(driverPath)).rejects.toThrow(
      "driver module must export async function reach(page)",
    );
  });
});

function startMockApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer((req, res) => {
      if (req.url === "/api/issues") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issues: [{ id: "issue-tracker", kind: "project", archived: false }],
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head><script>
document.documentElement.setAttribute("data-theme", localStorage.getItem("ui-theme") || "dark");
</script></head><body>mock ui</body></html>`);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mock server did not bind"));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}

function runCaptureScript(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      env,
      cwd: join(scriptPath, "..", ".."),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

describe("capture-screenshots driver integration", () => {
  let mockApp: Awaited<ReturnType<typeof startMockApp>>;
  let tempDir: string;
  let outDir: string;

  beforeEach(async () => {
    mockApp = await startMockApp();
    tempDir = mkdtempSync(join(tmpdir(), "screenshot-driver-run-"));
    outDir = join(tempDir, "out");
  });

  afterEach(async () => {
    await mockApp.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("refuses --driver combined with a positional target", async () => {
    const result = await runCaptureScript([
      "--base-url",
      mockApp.baseUrl,
      "--driver",
      "/tmp/reach.mjs",
      "/",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--driver cannot be combined with path or dialog targets");
  });

  it("captures one PNG when a driver reach settles the page", async () => {
    const markerPath = join(tempDir, "reach-called.txt");
    const driverPath = join(tempDir, "reach.mjs");
    writeFileSync(
      driverPath,
      `import { writeFileSync } from "node:fs";
export async function reach(page) {
  writeFileSync(${JSON.stringify(markerPath)}, String(Boolean(page)));
  await page.evaluate(() => { document.body.textContent = "settled"; });
}
`,
    );

    const result = await runCaptureScript([
      "--base-url",
      mockApp.baseUrl,
      "--driver",
      driverPath,
      "--out",
      outDir,
    ]);

    expect(result.status).toBe(0);
    expect(readFileSync(markerPath, "utf8")).toBe("true");
    expect(existsSync(join(outDir, "driver.png"))).toBe(true);
  });

  it("writes one PNG per theme when --theme both is set", async () => {
    const driverPath = join(tempDir, "reach-both.mjs");
    writeFileSync(
      driverPath,
      'export async function reach(page) { await page.evaluate(() => { document.body.textContent = "settled"; }); }\n',
    );

    const result = await runCaptureScript([
      "--base-url",
      mockApp.baseUrl,
      "--driver",
      driverPath,
      "--theme",
      "both",
      "--out",
      outDir,
    ]);

    expect(result.status).toBe(0);
    expect(existsSync(join(outDir, "driver-dark.png"))).toBe(true);
    expect(existsSync(join(outDir, "driver-light.png"))).toBe(true);
  });

  it("exits non-zero and writes no PNG when reach throws", async () => {
    const driverPath = join(tempDir, "throw.mjs");
    writeFileSync(driverPath, 'export async function reach() { throw new Error("boom"); }\n');

    const result = await runCaptureScript([
      "--base-url",
      mockApp.baseUrl,
      "--driver",
      driverPath,
      "--out",
      outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("boom");
    expect(existsSync(join(outDir, "driver.png"))).toBe(false);
  });
});

describe("capture-screenshots path integration", () => {
  let mockApp: Awaited<ReturnType<typeof startMockApp>>;
  let outDir: string;

  beforeEach(async () => {
    mockApp = await startMockApp();
    outDir = mkdtempSync(join(tmpdir(), "screenshot-path-run-"));
  });

  afterEach(async () => {
    await mockApp.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("captures a path target without --driver", async () => {
    const result = await runCaptureScript([
      "--base-url",
      mockApp.baseUrl,
      "--out",
      outDir,
      "/",
    ]);

    expect(result.status).toBe(0);
    expect(existsSync(join(outDir, "root.png"))).toBe(true);
  });
});

describe("pipelineRunsPageReady", () => {
  const listIdle = {
    body: "Recent runs",
    hasList: true,
    hasDiagram: false,
    hasPlaceholder: true,
  };

  it("treats a selected run as ready when the diagram is up and the list is still loading", () => {
    expect(
      pipelineRunsPageReady({
        pathname: "/runs/plan-pipeline-fixes",
        body: "Loading runs… SEQUENCE",
        hasList: false,
        hasDiagram: true,
        hasPlaceholder: false,
      }),
    ).toBe(true);
  });

  it("waits while a selected run's sequence is still loading", () => {
    expect(
      pipelineRunsPageReady({
        pathname: "/runs/plan-pipeline-fixes",
        body: "Loading sequence…",
        hasList: true,
        hasDiagram: false,
        hasPlaceholder: false,
      }),
    ).toBe(false);
  });

  it("still requires the index to leave Loading runs on /runs", () => {
    expect(
      pipelineRunsPageReady({
        pathname: "/runs",
        body: "Loading runs…",
        hasList: false,
        hasDiagram: false,
        hasPlaceholder: false,
      }),
    ).toBe(false);
    expect(
      pipelineRunsPageReady({
        pathname: "/runs",
        ...listIdle,
      }),
    ).toBe(true);
  });
});
