import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectConversationWriterViolations } from "./check-conversation-writer.js";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
  it("allows the conversation service to write meta and transcript files", () => {
    writeApp(
      "server/services/conversations.ts",
      [
        'import { appendFileSync, writeFileSync } from "fs";',
        "function metaPathOf(id: string) { return id; }",
        "function transcriptPathOf(id: string) { return id; }",
        "writeFileSync(metaPathOf(id), \"{}\");",
        "appendFileSync(transcriptPathOf(id), \"\\n\");",
        "",
      ].join("\n"),
    );
    writeApp(
      "server/services/conversation-fork.ts",
      [
        'import { writeFileSync } from "fs";',
        "import { transcriptPathOf } from \"./conversation-transcript-seq.js\";",
        "writeFileSync(transcriptPathOf(id), \"\");",
        "",
      ].join("\n"),
    );
    writeApp(
      "server/services/conversation-meta-index.ts",
      [
        'import { writeFileSync } from "fs";',
        'writeFileSync(join(dir, id, "meta.json"), body);',
        "",
      ].join("\n"),
    );

    expect(collectConversationWriterViolations(rootDir)).toEqual([]);
  });

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

  it("flags a transcript path helper used alongside a filesystem write", () => {
    writeApp(
      "server/services/side-writer.ts",
      [
        'import { appendFileSync } from "fs";',
        "import { transcriptPathOf } from \"./conversation-transcript-seq.js\";",
        "appendFileSync(transcriptPathOf(id), line);",
        "",
      ].join("\n"),
    );

    expect(collectConversationWriterViolations(rootDir)).toEqual([
      "app/server/services/side-writer.ts",
    ]);
  });

  it("allows reads of meta.json and test fixtures that write it", () => {
    writeApp(
      "server/services/conversation-ids.ts",
      [
        'import { readFileSync } from "fs";',
        "function metaPathOf(id: string) { return id; }",
        "export function read(id: string) { return readFileSync(metaPathOf(id), \"utf8\"); }",
        "",
      ].join("\n"),
    );
    writeApp(
      "server/services/conversations.test.ts",
      [
        'import { writeFileSync } from "fs";',
        'writeFileSync(join(dir, "meta.json"), "{}");',
        "",
      ].join("\n"),
    );
    writeApp(
      "cli.test-helpers.ts",
      [
        'import { writeFileSync } from "fs";',
        'writeFileSync(join(dir, "transcript.jsonl"), "\\n");',
        "",
      ].join("\n"),
    );

    expect(collectConversationWriterViolations(rootDir)).toEqual([]);
  });

  it("accepts this repository", () => {
    expect(collectConversationWriterViolations(PLUGIN_ROOT)).toEqual([]);
  });
});
