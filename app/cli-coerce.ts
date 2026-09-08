export function coerceBoolean(value: string, field: string): boolean {
  if (value !== "true" && value !== "false") {
    throw new Error(`invalid ${field} "${value}" (expected: true, false)`);
  }
  return value === "true";
}

export function coerceEnum(
  value: string,
  field: string,
  values: readonly string[],
): string {
  if (!values.includes(value)) {
    throw new Error(
      `invalid ${field} "${value}" (expected: ${values.join(", ")})`,
    );
  }
  return value;
}

export function coercePositiveInt(value: string, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`invalid ${field} "${value}" (expected a positive integer)`);
  }
  return n;
}

export function coerceJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid ${field} JSON: ${detail}`);
  }
}
