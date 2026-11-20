import type { ExecutionGate } from "@server/schemas";

export const IDEA_EXECUTION_GATE_OPTIONS: readonly {
  value: ExecutionGate;
  label: string;
  slug: string;
  effect: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    slug: "auto",
    effect:
      "decides from the code-gate verdict: gated waits, start starts",
  },
  {
    value: true,
    label: "On",
    slug: "on",
    effect: "waits for a human start",
  },
  {
    value: false,
    label: "Off",
    slug: "off",
    effect: "starts roots when decompose finishes",
  },
];

export function ideaExecutionGateOption(
  value: ExecutionGate,
): (typeof IDEA_EXECUTION_GATE_OPTIONS)[number] {
  const match = IDEA_EXECUTION_GATE_OPTIONS.find(
    (option) => option.value === value,
  );
  if (!match) {
    throw new Error(`unknown execution gate: ${String(value)}`);
  }
  return match;
}