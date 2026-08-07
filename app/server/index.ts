import { createApp } from "./app.js";
import { listenPort } from "./config.js";
import { agentSessions } from "./services/agent-sessions.js";
import { validateHookRegistration } from "./services/hook-registration.js";
import { validateRoleBodies } from "./services/role-bodies.js";

validateRoleBodies();
validateHookRegistration();

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
