import { assertSupportedNodeRuntime } from "./node-runtime.js";

// Gate before any other server module loads — static imports would pull in
// `@cursor/sdk` (via agent-sessions) and can native-crash on Node < 22.13.
assertSupportedNodeRuntime();

const { createApp } = await import("./app.js");
const { refreshAgentModelSlugsFromSdk } = await import(
  "./agent-model-slugs-sync.js"
);
const { listenPort } = await import("./config.js");
const { agentSessions } = await import("./services/agent-sessions.js");
const { validateHookRegistration } = await import(
  "./services/hook-registration.js"
);
const { installHttp2Diagnostics } = await import(
  "./services/http2-diagnostics.js"
);
const { validateRoleBodies } = await import("./services/role-bodies.js");

// Before anything can open an agent stream, so the patch lands first.
await installHttp2Diagnostics();

validateRoleBodies();
validateHookRegistration();

await refreshAgentModelSlugsFromSdk();

const app = createApp();

const server = app.listen(listenPort, () => {
  console.log(
    `issue-tracker server listening on http://localhost:${listenPort}`,
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}; disposing agent sessions…`);
  try {
    await agentSessions.disposeAll();
  } catch (err) {
    console.error("disposeAll failed", err);
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
