import type { SDKCustomTool, SDKToolAnnotations } from "@cursor/sdk";
import { expect } from "vitest";
import { z } from "zod";

export function expectToolAnnotations(
  tool: SDKCustomTool,
  expected: Required<
    Pick<
      SDKToolAnnotations,
      | "title"
      | "readOnlyHint"
      | "destructiveHint"
      | "idempotentHint"
      | "openWorldHint"
    >
  >,
): void {
  expect(tool.annotations).toEqual(expected);
}

export function expectResultMatchesOutputSchema(
  tool: SDKCustomTool,
  result: unknown,
): void {
  expect(tool.outputSchema).toBeDefined();
  const validator = z.fromJSONSchema(tool.outputSchema!);
  const parsed = validator.safeParse(result);
  expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(
    true,
  );
}
