import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const devPort = Number(process.env.VITE_DEV_PORT ?? 8060);
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8061";

export default defineConfig({
  plugins: [react()],
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
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
