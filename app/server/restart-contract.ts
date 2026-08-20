export const RESTART_SENTINEL_EXIT_CODE = 75;

export const RESTART_SUPERVISED_ENV_VAR = "RESTART_SUPERVISED";

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

/** True only for the sentinel exit — every other termination propagates. */
export function shouldRespawn(exit: ProcessExit): boolean {
  return exit.signal === null && exit.code === RESTART_SENTINEL_EXIT_CODE;
}
