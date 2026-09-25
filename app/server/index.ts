import { assertSupportedNodeRuntime } from "./node-runtime.js";

// Gate before any other server module loads — static imports would pull in
// `@cursor/sdk` (via agent-sessions) and can native-crash on Node < 22.13.
assertSupportedNodeRuntime();

const { installAbortErrorGuard } = await import("./abort-error-guard.js");
installAbortErrorGuard();

const { ensureChildReaper } = await import("./services/child-reaper.js");
ensureChildReaper();

const { captureRestartSupervision, RESTART_SUPERVISED_ENV_VAR } = await import(
  "./restart-contract.js"
);
captureRestartSupervision(Boolean(process.env[RESTART_SUPERVISED_ENV_VAR]));

const { captureMockupStackReapAtBoot } = await import("./mockup-stack-boot.js");
await captureMockupStackReapAtBoot();

const { attachMultiplexedWebSocket, createApp } = await import("./app.js");
const { attachMockupStackProxy } = await import("./routes/mockups.js");
const { refreshAgentModelSlugCatalog } = await import(
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

await refreshAgentModelSlugCatalog();

const { startStoreBackupSnapshotDriver } = await import(
  "./services/store-backup-snapshot.js"
);
startStoreBackupSnapshotDriver();

const app = createApp();

const { scrubOrphanedRunsAtBoot } = await import(
  "./services/orphan-run-scrub.js"
);
await scrubOrphanedRunsAtBoot();

const { startWorkQueueLauncher } = await import(
  "./services/work-queue-launcher.js"
);
startWorkQueueLauncher(agentSessions);

const { dropUnownedAgentStackRecords } = await import(
  "./services/agent-stack.js"
);
dropUnownedAgentStackRecords();

const { stopAllMockupStacks } = await import("./services/mockup-stack.js");

const server = app.listen(listenPort, () => {
  console.log(
    `issue-tracker server listening on http://localhost:${listenPort}`,
  );
});
attachMultiplexedWebSocket(server);
attachMockupStackProxy(server);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}; disposing agent sessions…`);
  let failed: unknown;
  try {
    await agentSessions.disposeAll();
    await stopAllMockupStacks();
  } catch (err) {
    failed = err;
    console.error("shutdown failed", err);
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  process.exit(failed === undefined ? 0 : 1);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
