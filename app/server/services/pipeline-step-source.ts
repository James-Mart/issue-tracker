import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, resolve, sep } from "path";
import { pipelines, type Pipeline } from "../../src/features/pipeline/shape.js";
import { pluginDir } from "../config.js";
import { IssueError } from "./errors.js";

export interface PipelineStepSource {
  source: string;
  markdown: string;
}

export interface GetPipelineStepSourceOptions {
  pluginRoot?: string;
  pipelineList?: Pipeline[];
}

function assertSafePluginRelPath(relPath: string): void {
  if (!relPath.trim()) {
    throw new IssueError(
      "validation",
      "plugin-relative path must be non-empty",
    );
  }
  if (isAbsolute(relPath)) {
    throw new IssueError(
      "validation",
      "plugin-relative path must be relative",
    );
  }
  const parts = relPath.split(/[/\\]/);
  if (parts.some((part) => part === ".." || part === "")) {
    throw new IssueError(
      "validation",
      'plugin-relative path must not contain ".." or empty segments',
    );
  }
}

function resolveUnderPluginRoot(root: string, relPath: string): string {
  assertSafePluginRelPath(relPath);
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new IssueError(
      "validation",
      "plugin-relative path escapes the plugin directory",
    );
  }
  return resolved;
}

function findDeclaredNode(stepId: string, pipelineList: Pipeline[]) {
  for (const pipeline of pipelineList) {
    const node = pipeline.nodes.find((n) => n.id === stepId);
    if (node) return node;
  }
  return undefined;
}

export function getPipelineStepSource(
  stepId: string,
  options: GetPipelineStepSourceOptions = {},
): PipelineStepSource {
  const pipelineList = options.pipelineList ?? pipelines;
  const node = findDeclaredNode(stepId, pipelineList);
  if (!node || node.kind === "handoff") {
    throw new IssueError("not_found", `pipeline step not found: ${stepId}`);
  }

  const root = options.pluginRoot ?? pluginDir;
  const source = node.source;
  const resolved = resolveUnderPluginRoot(root, source);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new IssueError("not_found", `pipeline step source not found: ${source}`);
  }

  return {
    source,
    markdown: readFileSync(resolved, "utf8"),
  };
}
