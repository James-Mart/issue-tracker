import { ApiError } from "@/lib/api/errors";

export type RunsInFlightRefusal = {
  activeRuns: { conversationId: string }[];
};

/** Parse a restart `runs-in-flight` 409 into the reported live conversations. */
export function parseRunsInFlightRefusal(
  err: unknown,
): RunsInFlightRefusal | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body;
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (record.code !== "runs-in-flight") return undefined;
  const activeRuns = record.activeRuns;
  if (!Array.isArray(activeRuns) || activeRuns.length === 0) return undefined;
  const parsed: { conversationId: string }[] = [];
  for (const run of activeRuns) {
    if (!run || typeof run !== "object") return undefined;
    const conversationId = (run as { conversationId?: unknown })
      .conversationId;
    if (typeof conversationId !== "string") return undefined;
    parsed.push({ conversationId });
  }
  return { activeRuns: parsed };
}

export function restartLiveTurnsMessage(count: number): string {
  const turns = count === 1 ? "1 agent turn" : `${count} agent turns`;
  return `Restarting now will drop ${turns} immediately. That work is not recovered.`;
}
