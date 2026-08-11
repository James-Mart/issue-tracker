import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractTaskHints } from "./event-pipeline.js";

describe("EventPipeline.failToolCall", () => {
  let root: string;
  let issuesRoot: string;
  let workspaceDir: string;

  const AT = "2026-07-25T12:00:00.000Z";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-pipeline-fail-"));
    issuesRoot = join(root, "issues");
    mkdirSync(issuesRoot, { recursive: true });
    workspaceDir = mkdtempSync(join(tmpdir(), "issue-pipeline-ws-"));
    mkdirSync(join(workspaceDir, ".git"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesRoot);
    mkdirSync(join(issuesRoot, "platform"), { recursive: true });
    writeFileSync(
      join(issuesRoot, "platform", "issue.json"),
      JSON.stringify({
        id: "platform",
        kind: "project",
        title: "Platform",
        workspace: workspaceDir,
        createdAt: AT,
        updatedAt: AT,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("persists a terminal tool_call with status error and failure class in the result", async () => {
    const { createConversation, readConversation } = await import(
      "./conversations.js"
    );
    const { EventPipeline } = await import("./event-pipeline.js");
    const meta = await createConversation({
      title: "Fail tool call",
      projectId: "platform",
      model: "composer-2.5",
    });

    const pipeline = new EventPipeline(meta.id);
    await pipeline.failToolCall("call-delegate-1", {
      name: "delegate",
      failureClass: "auth",
      message: "Authentication error.",
    });

    const { transcript } = readConversation(meta.id);
    expect(transcript).toEqual([
      expect.objectContaining({
        type: "tool_call",
        callId: "call-delegate-1",
        name: "delegate",
        status: "error",
        result: {
          status: "error",
          failureClass: "auth",
          message: "Authentication error.",
        },
      }),
    ]);
  });
});

describe("extractTaskHints", () => {
  // The SDK's task result is a `{ status, value }` union, so the hints a
  // Cursor Task call carries are one level down from the bridge's own shape.
  it("lifts hints out of the SDK task-result envelope", () => {
    expect(
      extractTaskHints({
        status: "success",
        value: {
          agentId: " bc-nested-1 ",
          transcriptPath: " /tmp/agent-transcripts/bc-nested-1 ",
          isBackground: false,
          backgroundReason: "unspecified",
        },
      }),
    ).toEqual({
      resultAgentId: "bc-nested-1",
      transcriptPath: "/tmp/agent-transcripts/bc-nested-1",
    });
  });

  it("lifts hints off a flat result", () => {
    expect(extractTaskHints({ agentId: "bc-nested-1" })).toEqual({
      resultAgentId: "bc-nested-1",
    });
  });

  it("returns nothing when no hint is present", () => {
    expect(extractTaskHints({ status: "error", error: "boom" })).toEqual({});
    expect(extractTaskHints({ agentId: "  " })).toEqual({});
    expect(extractTaskHints("delegation done")).toEqual({});
    expect(extractTaskHints(null)).toEqual({});
  });
});
