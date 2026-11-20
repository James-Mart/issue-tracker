/**
 * Which plan-setting controls show on an Idea. Out of band hides the others;
 * execution stays hidden while the decomposition gate is on.
 */
export function planSettingVisibility(input: {
  outOfBand: boolean;
  decompositionGate: boolean;
}): { decomposition: boolean; execution: boolean } {
  if (input.outOfBand) {
    return { decomposition: false, execution: false };
  }
  return {
    decomposition: true,
    execution: !input.decompositionGate,
  };
}