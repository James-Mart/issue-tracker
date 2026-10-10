import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectConversationWriterViolations } from "./check-conversation-writer.js";

let rootDir: string;

function writeApp(relPath: string, content: string): void {
  const full = join(rootDir, "app", relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-conversation-writer-"));
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectConversationWriterViolations", () => {
  it("flags a write of meta.json outside the conversation service", () => {
    writeApp(
      "server/services/other.ts",
      [
        'import { writeFileSync } from "fs";',
        'import { join } from "path";',
        'writeFileSync(join(dir, "meta.json"), "{}\\n");',
        "",
      ].join("\n"),
    );

    expect(collectConversationWriterViolations(rootDir)).toEqual([
      "app/server/services/other.ts",
    ]);
  });
});
