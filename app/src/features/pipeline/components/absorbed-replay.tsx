import { formatRunDurationMs } from "@/features/issues/components/agent-runs-panel";
import { cn } from "@/lib/utils/cn";
import type { AbsorbedReplay, SequenceBeat } from "../run-sequence";

export function absorbedReplayCount(beat: SequenceBeat): number {
  return beat.absorbedReplays?.length ?? 0;
}

export function AbsorbedReplayChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border",
        "border-[hsl(var(--warn)/0.45)] bg-[hsl(var(--warn)/0.12)]",
        "px-1.5 py-0 font-mono text-[9px] font-medium lowercase",
        "text-[hsl(var(--warn))]",
      )}
      data-testid="absorbed-replay-chip"
      data-count={count}
    >
      absorbed ×{count}
    </span>
  );
}

function formatReplayAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function gapAfterOriginal(startedAt: string, at: string): string | undefined {
  const ms = Date.parse(at) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return undefined;
  return formatRunDurationMs(ms);
}

function outcomeSentence(outcome: AbsorbedReplay["outcome"]): string {
  if (outcome === "joined-in-flight") return "Joined the in-flight call.";
  return "Returned the stored result — replay after the original finished.";
}

export function AbsorbedReplayDetail({
  beat,
  replay,
}: {
  beat: SequenceBeat;
  replay: AbsorbedReplay;
}) {
  const gap = gapAfterOriginal(beat.startedAt, replay.at);
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-[hsl(var(--warn)/0.35)]",
        "bg-[hsl(var(--warn)/0.08)] px-2.5 py-2",
      )}
      data-testid="absorbed-replay-detail"
      data-tool-call-id={replay.toolCallId}
      data-tool={replay.tool}
      data-outcome={replay.outcome}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10px] font-semibold text-[hsl(var(--warn))]">
          Replay absorbed
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatReplayAt(replay.at)}
          {gap !== undefined ? ` · ${gap} after original` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-foreground/90">
        SDK re-invoked <span className="font-medium">{replay.tool}</span> with
        the same tool call; the tool did not run again.{" "}
        {outcomeSentence(replay.outcome)}
      </p>
      <dl className="mt-2 text-[10px] leading-relaxed">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="shrink-0 text-muted-foreground">Tool call</dt>
          <dd className="min-w-0 break-all font-mono text-foreground/80">
            {replay.toolCallId}
          </dd>
        </div>
      </dl>
    </div>
  );
}
