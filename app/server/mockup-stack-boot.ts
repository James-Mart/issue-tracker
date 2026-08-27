import {
  reapOrphanedMockupStacksAtBoot,
  type MockupStackReapReport,
} from "./services/mockup-stack.js";

let capturedReapReport: MockupStackReapReport | undefined;

/**
 * Sweep orphaned mockup stacks once at API boot and record what was reaped.
 */
export async function captureMockupStackReapAtBoot(): Promise<void> {
  const report = await reapOrphanedMockupStacksAtBoot();
  capturedReapReport = report;
  if (
    report.staleStateRemoved.length > 0 ||
    report.orphanedStacksStopped.length > 0
  ) {
    console.log(
      "reaped orphaned mockup stacks at boot:",
      JSON.stringify(report),
    );
  }
}

/** What the boot sweep removed, after {@link captureMockupStackReapAtBoot}. */
export function getMockupStackReapReport(): MockupStackReapReport | undefined {
  return capturedReapReport;
}
