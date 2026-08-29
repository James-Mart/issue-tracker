import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectClientBoundaryViolations } from "./check-client-boundary.js";

let rootDir: string;
let srcDir: string;
let serverDir: string;

function writeSrc(relPath: string, content: string): void {
  const full = join(srcDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function writeServer(relPath: string, content: string): void {
  const full = join(serverDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-client-boundary-lint-"));
  srcDir = join(rootDir, "src");
  serverDir = join(rootDir, "server");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });

  writeServer(
    "schemas.ts",
    ['import { z } from "zod";', "", "export const ok = z.string();", ""].join(
      "\n",
    ),
  );
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectClientBoundaryViolations", () => {
  it("allows zod when the chain stops at an allowlisted validator module", () => {
    writeSrc(
      "features/issues/lib/personas.ts",
      [
        'import { personasSchema } from "@server/schemas";',
        "",
        "export function validate(input: unknown) {",
        "  return personasSchema.safeParse(input);",
        "}",
      ].join("\n"),
    );
    writeSrc(
      "features/issues/components/personas-editor.tsx",
      [
        'import { validate } from "@/features/issues/lib/personas";',
        "",
        "export function PersonasEditor() {",
        "  return validate([]);",
        "}",
      ].join("\n"),
    );

    expect(collectClientBoundaryViolations(rootDir)).toEqual([]);
  });

  it("reports a rejected chain that value-imports a module reaching zod", () => {
    writeSrc(
      "features/pipeline/live-hook.ts",
      [
        'import { ok } from "@server/schemas";',
        "",
        "export function useLive() {",
        "  return ok;",
        "}",
      ].join("\n"),
    );

    const violations = collectClientBoundaryViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: "src/features/pipeline/live-hook.ts",
      chain: [
        "src/features/pipeline/live-hook.ts",
        "server/schemas.ts",
        "package:zod",
      ],
    });
  });

  it("still reports Node builtin chains", () => {
    writeServer("unsafe.ts", ['import fs from "fs";', "", "export const x = fs;", ""].join("\n"));
    writeSrc(
      "leak.ts",
      ['import { x } from "@server/unsafe";', "", "export const y = x;", ""].join("\n"),
    );

    const violations = collectClientBoundaryViolations(rootDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.chain.at(-1)).toBe("builtin:fs");
  });
});
