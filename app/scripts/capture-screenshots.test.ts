import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./capture-screenshots.ts", import.meta.url));

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

describe("capture-screenshots driver integration", { timeout: 20_000 }, () => {
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
}, 20_000);
