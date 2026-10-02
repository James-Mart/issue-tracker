#!/usr/bin/env node
// One-time setup: npm link in this plugin's app/ directory, then invoke as
// `issue <verb>` — see SPEC CLI invariants
// (/root/.cursor/plugins/local/issue-tracker/app).
//
// tsx otherwise looks up tsconfig.json from the caller's cwd, so the `@/` and
// `@server/` path aliases would only resolve when run from app/.
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
await import("../cli.ts");
