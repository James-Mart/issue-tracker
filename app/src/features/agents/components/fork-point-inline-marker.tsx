import type { TranscriptEvent } from "@server/schemas";
import type { TranscriptRenderSegment } from "../lib/transcript-rows";

const FORK_POINT_MARKER_COPY =
  "History above was inherited · messages below are this conversation's own.";

export function segmentEventIndices(
  events: TranscriptEvent[],
  segment: TranscriptRenderSegment,
): number[] {
  if (segment.kind === "tool_use_group") {
    return segment.events.map((event) => events.indexOf(event));
  }
  return [events.indexOf(segment.event)];
}

export function forkPointMarkerDueBeforeSegment(
  forkAtEventIndex: number,
  segmentMinIndex: number,
  forkMarkerInserted: boolean,
): boolean {
  return (
    forkAtEventIndex >= 0 &&
    !forkMarkerInserted &&
    segmentMinIndex > forkAtEventIndex
  );
}

export function forkPointMarkerDueAfterSegment(
  forkAtEventIndex: number,
  maxRenderedEventIndex: number,
  forkMarkerInserted: boolean,
): boolean {
  return (
    forkAtEventIndex >= 0 &&
    !forkMarkerInserted &&
    maxRenderedEventIndex >= forkAtEventIndex
  );
}

export function ForkPointInlineMarker() {
  return (
    <div
      className="my-4 min-w-0 border-t border-border pt-3"
      data-testid="fork-point-inline-marker"
      role="separator"
      aria-label={FORK_POINT_MARKER_COPY}
    >
      <p className="font-mono text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
        {FORK_POINT_MARKER_COPY}
      </p>
    </div>
  );
}
