import { describe, expect, it } from "vitest";
import { summarizeToolCall, thinkingPreview } from "./tool-summary";

describe("summarizeToolCall", () => {
  it('uses "tool" when the name is missing or blank', () => {
    expect(summarizeToolCall(undefined, undefined)).toEqual({
      label: "tool",
      detail: null,
    });
    expect(summarizeToolCall(null, undefined)).toEqual({
      label: "tool",
      detail: null,
    });
    expect(summarizeToolCall("   ", undefined)).toEqual({
      label: "tool",
      detail: null,
    });
  });

  it("trims the tool name and uses case-insensitive summarizer lookup", () => {
    expect(
      summarizeToolCall("  Shell  ", {
        command: "git status",
        description: "Check repo state",
      }),
    ).toEqual({
      label: "Shell",
      detail: "git status",
    });
  });

  it("summarizes shell from command", () => {
    expect(
      summarizeToolCall("shell", { command: "npm test", block_until_ms: 30000 }),
    ).toEqual({ label: "shell", detail: "npm test" });
  });

  it("summarizes read, edit, and delete from shortened path", () => {
    const args = {
      path: "/root/.cursor/plugins/local/issue-tracker/app/src/foo.ts",
    };
    expect(summarizeToolCall("read", args)).toEqual({
      label: "read",
      detail: "src/foo.ts",
    });
    expect(summarizeToolCall("Edit", args)).toEqual({
      label: "Edit",
      detail: "src/foo.ts",
    });
    expect(summarizeToolCall("DELETE", args)).toEqual({
      label: "DELETE",
      detail: "src/foo.ts",
    });
  });

  it("summarizes grep from pattern and optional glob or path", () => {
    expect(summarizeToolCall("grep", { pattern: "foo" })).toEqual({
      label: "grep",
      detail: "foo",
    });
    expect(
      summarizeToolCall("grep", { pattern: "foo", glob: "*.ts" }),
    ).toEqual({ label: "grep", detail: "foo in *.ts" });
    expect(
      summarizeToolCall("grep", {
        pattern: "foo",
        path: "/root/proj/app/src/lib/util.ts",
      }),
    ).toEqual({ label: "grep", detail: "foo in lib/util.ts" });
  });

  it("summarizes glob from globPattern and optional targetDirectory", () => {
    expect(summarizeToolCall("glob", { globPattern: "**/*.tsx" })).toEqual({
      label: "glob",
      detail: "**/*.tsx",
    });
    expect(
      summarizeToolCall("glob", {
        globPattern: "**/*.tsx",
        targetDirectory: "/root/proj/app/src/components",
      }),
    ).toEqual({ label: "glob", detail: "**/*.tsx in src/components" });
  });

  it("summarizes readlints from paths array", () => {
    expect(
      summarizeToolCall("readlints", {
        paths: [
          "/root/proj/app/src/a.ts",
          "/root/proj/app/src/b.ts",
        ],
      }),
    ).toEqual({ label: "readlints", detail: "src/a.ts, src/b.ts" });
  });

  it("summarizes updatetodos from todos count", () => {
    expect(summarizeToolCall("updatetodos", { todos: [{ id: "1" }] })).toEqual({
      label: "updatetodos",
      detail: "1 todo",
    });
    expect(
      summarizeToolCall("updatetodos", {
        todos: [{ id: "1" }, { id: "2" }],
      }),
    ).toEqual({ label: "updatetodos", detail: "2 todos" });
  });

  it("summarizes createplan from first line of plan", () => {
    expect(
      summarizeToolCall("createplan", {
        plan: "# Refactor auth\n\nDetails here.",
      }),
    ).toEqual({ label: "createplan", detail: "# Refactor auth" });
  });

  it("summarizes mcp from providerIdentifier and toolName", () => {
    expect(
      summarizeToolCall("mcp", {
        providerIdentifier: "custom-user-tools",
        toolName: "delegate",
      }),
    ).toEqual({
      label: "mcp",
      detail: "custom-user-tools/delegate",
    });
  });

  it("falls back to first string arg for unregistered tools", () => {
    expect(
      summarizeToolCall("Task", {
        description: "Explore codebase",
        subagent_type: "explore",
      }),
    ).toEqual({
      label: "Task",
      detail: "Explore codebase",
    });
  });

  it("truncates detail to 80 characters", () => {
    const long = "x".repeat(100);
    expect(summarizeToolCall("Read", { path: long }).detail).toHaveLength(80);
    expect(summarizeToolCall("shell", { command: long }).detail).toHaveLength(80);
  });

  it("returns null detail when args is not an object", () => {
    expect(summarizeToolCall("Grep", "pattern").detail).toBeNull();
    expect(summarizeToolCall("Grep", 42).detail).toBeNull();
  });
});

describe("thinkingPreview", () => {
  it("uses the first non-empty line", () => {
    expect(
      thinkingPreview("\n\nNeed to inspect transcript-ui.tsx\nMore here."),
    ).toBe("Need to inspect transcript-ui.tsx");
  });

  it("returns null for whitespace-only text", () => {
    expect(thinkingPreview("\n\n  \n")).toBeNull();
  });

  it("truncates to 80 characters", () => {
    expect(thinkingPreview("x".repeat(100))).toHaveLength(80);
  });
});
