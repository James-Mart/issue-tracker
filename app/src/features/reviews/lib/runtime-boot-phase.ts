import type { RuntimeBootPhase } from "@server/schemas";
import { formatRunDurationMs } from "@/features/issues/lib/run-time-format";

const PHASE_BOOT_UI = {
  build: {
    rowLabel: "Building…",
    modalTitle: "Building",
    failedTitle: "Build failed",
  },
  start: {
    rowLabel: "Starting…",
    modalTitle: "Starting",
    failedTitle: "Start failed",
  },
  seed: {
    rowLabel: "Seeding…",
    modalTitle: "Seeding",
    failedTitle: "Seed failed",
  },
  readiness: {
    rowLabel: "Waiting for readiness…",
    modalTitle: "Waiting for readiness",
    failedTitle: "Readiness failed",
  },
} as const satisfies Record<
  RuntimeBootPhase,
  { rowLabel: string; modalTitle: string; failedTitle: string }
>;

export function bootingPhaseRowLabel(phase: RuntimeBootPhase): string {
  return PHASE_BOOT_UI[phase].rowLabel;
}

export function bootingPhaseModalTitle(phase: RuntimeBootPhase): string {
  return PHASE_BOOT_UI[phase].modalTitle;
}

export function failedPhaseModalTitle(phase: RuntimeBootPhase): string {
  return PHASE_BOOT_UI[phase].failedTitle;
}

/** Undefined when `startedAt` is not a valid time — caller omits elapsed text. */
export function formatBootPhaseElapsed(
  startedAt: string,
  nowMs: number,
): string | undefined {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return undefined;
  return formatRunDurationMs(Math.max(0, nowMs - start));
}
