import type { ActiveRun, AgentSessions } from "./agent-sessions.js";

/** Sessions that start every prompted conversation and record the order they started in. */
export function fakeLauncherSessions(): {
  sessions: AgentSessions;
  started: string[];
} {
  const active = new Map<string, ActiveRun>();
  const started: string[] = [];
  const sessions = {
    async sendPrompt(conversationId: string) {
      const run: ActiveRun = {
        id: `run-${conversationId}`,
        startedAt: "2026-07-09T14:00:00.000Z",
        steer: async () => "complete_delivered",
        wait: () => Promise.resolve({} as Awaited<ReturnType<ActiveRun["wait"]>>),
      };
      active.set(conversationId, run);
      started.push(conversationId);
      return { ok: true as const, run };
    },
    getActiveRun(conversationId: string) {
      return active.get(conversationId);
    },
    listActiveRuns() {
      return [...active.keys()].map((conversationId) => ({ conversationId }));
    },
    async cancel() {
      return false;
    },
    async dispose() {},
    async disposeAll() {},
  } satisfies AgentSessions;
  return { sessions, started };
}
