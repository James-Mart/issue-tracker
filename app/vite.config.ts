import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Vitest } from "vitest/node";
import type { Reporter } from "vitest/reporters";
import { independentBootstrapFaultEntryProblem } from "./scripts/bootstrap-fault-entry.js";
import { revalidateOptimizedDeps } from "./scripts/optimized-deps-cache.js";
import { acquireWorkerSlots, computeWorkerSlotBudget } from "./scripts/worker-slot-pool.js";

// Workers reload this config in a separate process; reuse the parent dir so
// worker-<pid>.json and Node fatal-error reports stay in one directory.
const heapReportDir =
  process.env.VITEST_HEAP_REPORT_DIR ??
  mkdtempSync(join(tmpdir(), "vitest-heap-reports-"));
if (!process.env.VITEST_HEAP_REPORT_DIR) {
  process.env.VITEST_HEAP_REPORT_DIR = heapReportDir;
  process.on("exit", () => {
    rmSync(heapReportDir, { recursive: true, force: true });
  });
}

const indexHtmlPath = fileURLToPath(new URL("./index.html", import.meta.url));
const bootstrapFaultSrcPath = fileURLToPath(
  new URL("./src/app/bootstrap-fault.ts", import.meta.url),
);

const BOOTSTRAP_FAULT_DEV_SCRIPT =
  /<script type="module" src="\/src\/app\/bootstrap-fault\.ts"><\/script>\s*/;

/**
 * Vite folds every `<script type="module">` in one HTML file into a single
 * production chunk. Keep bootstrap-fault as its own Rollup entry and inject
 * that file into the built HTML so a failed main chunk can still paint Fault.
 */
function bootstrapFaultProductionEntry(): Plugin[] {
  return [
    {
      name: "bootstrap-fault-production-input",
      apply: "build",
      config() {
        return {
          build: {
            rollupOptions: {
              input: {
                main: indexHtmlPath,
                "bootstrap-fault": bootstrapFaultSrcPath,
              },
            },
          },
        };
      },
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html.replace(BOOTSTRAP_FAULT_DEV_SCRIPT, "");
        },
      },
    },
    {
      name: "bootstrap-fault-production-inject",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(html, ctx) {
          const chunk = ctx.bundle
            ? Object.values(ctx.bundle).find(
                (item) =>
                  item.type === "chunk" &&
                  item.isEntry &&
                  item.name === "bootstrap-fault",
              )
            : undefined;
          if (!chunk || chunk.type !== "chunk") {
            throw new Error(
              "bootstrap-fault entry chunk missing from the production bundle",
            );
          }
          const tag = `<script type="module" crossorigin src="/${chunk.fileName}"></script>`;
          const injected = html.includes(tag)
            ? html
            : html.replace(
                /<script type="module"/,
                `${tag}\n    <script type="module"`,
              );
          const problem = independentBootstrapFaultEntryProblem(injected);
          if (problem) throw new Error(problem);
          return injected;
        },
      },
    },
  ];
}

/** Keeps a returning browser from holding dep files the server has replaced. */
function revalidatedOptimizedDeps(): Plugin {
  return {
    name: "revalidate-optimized-deps",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(revalidateOptimizedDeps());
    },
  };
}

/**
 * Vitest reports the run's test files before it creates the forks pool, which
 * reads its worker counts from the config at creation. The run requests one
 * slot per file up to the budget and sizes the pool to the grant.
 */
function workerSlotPool(): Reporter {
  let vitest: Vitest | undefined;
  let acquired = false;
  return {
    onInit(ctx) {
      vitest = ctx;
    },
    async onPathsCollected(paths = []) {
      if (acquired) return;
      if (!vitest) throw new Error("worker-slot pool: onPathsCollected before onInit");
      acquired = true;
      const slots = await acquireWorkerSlots(
        Math.min(paths.length, computeWorkerSlotBudget()),
      );
      const poolOptions = (vitest.config.poolOptions ??= {});
      const forks = (poolOptions.forks ??= {});
      forks.maxForks = slots;
      forks.minForks = slots;
    },
  };
}

const devPort = Number(process.env.VITE_DEV_PORT ?? 8060);
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8061";

/** Bumped on every vite config load so a restart retires stale SharedWorkers. */
const transportVersion = Date.now();

export default defineConfig({
  plugins: [
    react(),
    revalidatedOptimizedDeps(),
    ...bootstrapFaultProductionEntry(),
  ],
  define: {
    __TRANSPORT_VERSION__: JSON.stringify(transportVersion),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@server": fileURLToPath(new URL("./server", import.meta.url)),
    },
  },
  server: {
    port: devPort,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: ["issues.martfamily.cc"],
    proxy: {
      "/api": {
        target: apiProxyTarget,
        ws: true,
      },
      "/mockups": {
        target: apiProxyTarget,
        ws: true,
      },
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    setupFiles: ["./test/vitest-worker-temp.ts", "./test/vitest-worker-hardening.ts"],
    env: {
      VITEST_HEAP_REPORT_DIR: heapReportDir,
    },
    reporters: ["default", "./test/memory-limit-reporter.ts", workerSlotPool()],
    poolOptions: {
      forks: {
        // A pool started without a grant (e.g. `--reporter` replacing the
        // configured reporters) runs one worker.
        maxForks: 1,
        minForks: 1,
        execArgv: [
          "--max-old-space-size=2048",
          "--report-on-fatalerror",
          `--report-directory=${heapReportDir}`,
        ],
      },
    },
  },
});
