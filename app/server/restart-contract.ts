export const RESTART_SENTINEL_EXIT_CODE = 75;

export const RESTART_SUPERVISED_ENV_VAR = "RESTART_SUPERVISED";

let capturedSupervision: boolean | undefined;

/**
 * Record whether this process is the supervisor's direct child, then drop the
 * env marker so descendants do not inherit it.
 */
export function captureRestartSupervision(supervised: boolean): void {
  capturedSupervision = supervised;
  delete process.env[RESTART_SUPERVISED_ENV_VAR];
}

/** Whether this process was launched under the restart supervisor. */
export function isRestartSupervised(): boolean {
  return capturedSupervision ?? Boolean(process.env[RESTART_SUPERVISED_ENV_VAR]);
}

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

/** True only for the sentinel exit — every other termination propagates. */
export function shouldRespawn(exit: ProcessExit): boolean {
  return exit.signal === null && exit.code === RESTART_SENTINEL_EXIT_CODE;
}
