import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentGlow } from "@/components/ui/overlay-surfaces";
import { cn } from "@/lib/utils/cn";
import { VOICE_RECORDING_CAP_SECONDS } from "../hooks/use-voice-recording";

export const VOICE_RECORDING_CAP_LABEL = `${Math.floor(VOICE_RECORDING_CAP_SECONDS / 60)}:00`;

export function formatVoiceElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VoiceRecordingBar({
  elapsedSeconds,
  live,
  onDiscard,
  onConfirm,
}: {
  elapsedSeconds: number;
  live: boolean;
  onDiscard: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-[hsl(var(--panel-2))] px-3 py-2 shell:min-h-9"
      data-testid="voice-recording-bar"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--current))]",
            live && cn(currentGlow, "motion-safe:animate-live-dot"),
          )}
        />
        <span
          className="font-mono text-xs tabular-nums text-foreground"
          data-testid="voice-recording-timer"
        >
          {formatVoiceElapsed(elapsedSeconds)} / {VOICE_RECORDING_CAP_LABEL}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 bg-[hsl(var(--panel))] hover:border-[hsl(var(--rail-lit))] shell:h-9 shell:w-9"
          title="Discard recording"
          aria-label="Discard recording"
          onClick={onDiscard}
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="primary"
          size="icon"
          className="h-11 w-11 shrink-0 shell:h-9 shell:w-9"
          title="Confirm recording"
          aria-label="Confirm recording"
          onClick={onConfirm}
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function VoiceErrorBar({
  reason,
  onRetry,
}: {
  reason: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
      data-testid="voice-error-bar"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-xs text-foreground">{reason}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid="voice-error-retry"
      >
        Retry
      </Button>
    </div>
  );
}

export function VoiceTranscribingField() {
  return (
    <div
      className="flex min-h-[44px] min-w-0 max-h-40 w-full flex-1 basis-[12rem] items-center gap-2 rounded-md border border-border bg-[hsl(var(--panel))] px-3 py-2 text-[hsl(var(--current))] shell:w-auto"
      data-testid="voice-transcribing-field"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" />
      <span className="text-sm">Transcribing…</span>
    </div>
  );
}
