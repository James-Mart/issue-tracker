import { Loader2, Play, SquareParking } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useParkWorkRoot, useResumeParkedWorkRoot } from "../api/mutations";

/** Icon-only park for a paused queue row. Frees the slot. */
export function QueueParkControl({ issueId }: { issueId: string }) {
  const park = useParkWorkRoot(issueId);
  const busy = park.isPending;

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title={busy ? "Parking" : "Park"}
      aria-label={busy ? "Parking" : "Park"}
      aria-busy={busy || undefined}
      data-testid={busy ? "flow-row-park-pending" : "flow-row-park"}
      disabled={busy}
      onClick={() => {
        if (busy) return;
        park.mutate();
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <SquareParking className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

/** Icon-only Play that returns a parked root to the front of the waiting roots. */
export function ParkedResumeControl({
  issueId,
  testId,
}: {
  issueId: string;
  testId: string;
}) {
  const resume = useResumeParkedWorkRoot(issueId);
  const busy = resume.isPending;

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title={busy ? "Resuming" : "Resume"}
      aria-label={busy ? "Resuming" : "Resume"}
      aria-busy={busy || undefined}
      data-testid={busy ? `${testId}-pending` : testId}
      disabled={busy}
      onClick={() => {
        if (busy) return;
        resume.mutate();
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
