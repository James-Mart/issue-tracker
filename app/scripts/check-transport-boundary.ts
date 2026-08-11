#!/usr/bin/env -S npx tsx
// Transport-construction boundary lint.
//
// Exactly one client module may open a realtime connection (`WebSocket` or
// `EventSource`). If a component constructs either, the per-tab socket budget
// scales with render-tree shape — a bug that only shows up at several tabs.
//
// This check walks every `src/**` file and fails when `new WebSocket(...)` or
// `new EventSource(...)` appears outside the upstream socket module (the inner
// client used by the direct path and the SharedWorker).
//
// Run: `npm run lint:transport` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = resolve(APP_DIR, "src");
const TRANSPORT_SOCKET_MODULE = resolve(SRC_DIR, "lib/ws/transport.socket.ts");

const CONSTRUCT_RE =
  /\bnew\s+(?:window\.|globalThis\.)?(WebSocket|EventSource)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => relative(APP_DIR, f);

const violations: string[] = [];
for (const file of walk(SRC_DIR)) {
  if (file === TRANSPORT_SOCKET_MODULE) continue;
  const src = readFileSync(file, "utf8");
  if (CONSTRUCT_RE.test(src)) violations.push(rel(file));
}

if (violations.length === 0) {
  console.log(
    "transport-boundary: OK — only the upstream socket module constructs WebSocket/EventSource.",
  );
  process.exit(0);
}

console.error(
  `transport-boundary: ${violations.length} file(s) construct WebSocket or EventSource outside the transport socket module.\n` +
    "Components must subscribe via the shared transport client; only `src/lib/ws/transport.socket.ts` may open a connection.\n",
);
for (const file of violations) {
  console.error(`  ${file}`);
}
process.exit(1);
