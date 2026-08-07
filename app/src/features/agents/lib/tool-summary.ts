export type ToolSummary = { label: string; detail: string | null };

const DETAIL_MAX = 80;

function firstStringDetail(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  for (const key of Object.keys(args)) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return value.length <= DETAIL_MAX ? value : value.slice(0, DETAIL_MAX);
    }
  }
  return null;
}

export function summarizeToolCall(
  name: string | null | undefined,
  args: unknown,
): ToolSummary {
  const trimmed = name?.trim();
  return {
    label: trimmed || "tool",
    detail: firstStringDetail(args),
  };
}
