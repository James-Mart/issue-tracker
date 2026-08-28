import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { Pipeline } from "../../src/features/pipeline/shape.js";
import { pluginDir } from "../config.js";
import { IssueError } from "./errors.js";
import { getPipelineStepSource } from "./pipeline-step-source.js";

let tempRoot: string;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("getPipelineStepSource", () => {
  it("returns the declared source path and markdown for a step", () => {
    const result = getPipelineStepSource("implement");
    expect(result.source).toBe("agents/_issue-tracker-implementor.md");
    expect(result.markdown).toBe(
      readFileSync(
        join(pluginDir, "agents/_issue-tracker-implementor.md"),
        "utf8",
      ),
    );
  });

  it("returns 404 for an unknown step id", () => {
    expect(() => getPipelineStepSource("not-a-step")).toThrow(IssueError);
    try {
      getPipelineStepSource("not-a-step");
    } catch (err) {
      expect(err).toMatchObject({
        code: "not_found",
        status: 404,
      });
    }
  });

  it("returns 404 for a handoff node", () => {
    expect(() => getPipelineStepSource("work-handoff")).toThrow(IssueError);
    try {
      getPipelineStepSource("work-handoff");
    } catch (err) {
      expect(err).toMatchObject({
        code: "not_found",
        status: 404,
      });
    }
  });

  it("refuses a declaration entry whose path escapes the plugin root", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "issue-pipeline-step-source-"));
    mkdirSync(join(tempRoot, "agents"), { recursive: true });
    writeFileSync(join(tempRoot, "outside-secret.txt"), "secret", "utf8");

    const escapePipeline: Pipeline[] = [
      {
        id: "planning",
        title: "Escape test",
        nodes: [
          {
            id: "escape-step",
            name: "Escape",
            kind: "step",
            pipeline: "planning",
            source: "../outside-secret.txt",
          },
        ],
        edges: [],
      },
    ];

    expect(() =>
      getPipelineStepSource("escape-step", {
        pluginRoot: tempRoot,
        pipelineList: escapePipeline,
      }),
    ).toThrow(/plugin-relative path/);

    expect(readFileSync(join(tempRoot, "outside-secret.txt"), "utf8")).toBe(
      "secret",
    );
  });
});
