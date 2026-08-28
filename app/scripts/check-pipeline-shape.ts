#!/usr/bin/env -S npx tsx
// Declared-edge drift guard.
//
// Cross-checks the pipeline shape declaration against the harness on disk:
// every declared `source` must exist, every declared `spawn` edge must have a
// counterpart in `collectSpawnEdges`, and every collected spawn whose ends
// are both declared nodes must have a declared `spawn` edge.
//
// Mapping is file-to-file: a collected edge's spawner file matches a node
// through that node's `source` path, and a spawned role matches a node
// through `agents/<role>.md`. Name-to-name comparison is not used.
//
// Edges of kind `flow` and `loop` are outside this check by design.
// Sequencing, loops, and gates have no spawn-stub form in the prose to parse,
// so the guard cannot see them. The omission is the jurisdiction boundary,
// not a gap.
//
// Run: `npm run lint:pipeline-shape` (also part of `npm test`).

import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  pipelines,
  type Pipeline,
  type PipelineNode,
  type PipelineStepNode,
} from "../src/features/pipeline/shape.js";
import { collectSpawnEdges } from "./check-agent-spawns.js";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

function hasSource(node: PipelineNode): node is PipelineStepNode {
  return node.kind === "step" || node.kind === "gate";
}

function sourceForRole(role: string): string {
  return `agents/${role}.md`;
}

function nodeById(pipeline: Pipeline, id: string): PipelineNode {
  const node = pipeline.nodes.find((n) => n.id === id);
  if (!node) {
    throw new Error(`pipeline '${pipeline.id}' edge names unknown node '${id}'`);
  }
  return node;
}

/**
 * Collect declared-edge drift violations for a plugin root that contains
 * `agents/` and `skills/`. `declaredPipelines` defaults to the harness
 * declaration; tests pass a fixture list.
 */
export function collectPipelineShapeViolations(
  rootDir: string,
  declaredPipelines: readonly Pipeline[] = pipelines,
): string[] {
  const violations: string[] = [];
  const collected = collectSpawnEdges(rootDir);

  const stepNodes: PipelineStepNode[] = [];
  const declaredSpawns: {
    from: string;
    to: string;
    fromSource: string;
    toSource: string;
  }[] = [];

  for (const pipeline of declaredPipelines) {
    for (const node of pipeline.nodes) {
      if (!hasSource(node)) continue;
      stepNodes.push(node);
      if (!existsSync(resolve(rootDir, node.source))) {
        violations.push(
          `declared source '${node.source}' (node '${node.id}') does not exist`,
        );
      }
    }

    for (const edge of pipeline.edges) {
      if (edge.kind !== "spawn") continue;
      const fromNode = nodeById(pipeline, edge.from);
      const toNode = nodeById(pipeline, edge.to);
      if (!hasSource(fromNode) || !hasSource(toNode)) {
        violations.push(
          `declared spawn ${edge.from} → ${edge.to} has no counterpart among collectSpawnEdges`,
        );
        continue;
      }
      declaredSpawns.push({
        from: edge.from,
        to: edge.to,
        fromSource: fromNode.source,
        toSource: toNode.source,
      });
    }
  }

  for (const spawn of declaredSpawns) {
    const found = collected.some(
      (edge) =>
        edge.spawnerFile === spawn.fromSource &&
        sourceForRole(edge.spawnedRole) === spawn.toSource,
    );
    if (!found) {
      violations.push(
        `declared spawn ${spawn.from} → ${spawn.to} has no counterpart among collectSpawnEdges`,
      );
    }
  }

  for (const edge of collected) {
    const fromNodes = stepNodes.filter((n) => n.source === edge.spawnerFile);
    const toNodes = stepNodes.filter(
      (n) => n.source === sourceForRole(edge.spawnedRole),
    );
    if (fromNodes.length === 0 || toNodes.length === 0) continue;

    const covered = declaredSpawns.some(
      (spawn) =>
        fromNodes.some((n) => n.id === spawn.from) &&
        toNodes.some((n) => n.id === spawn.to),
    );
    if (!covered) {
      violations.push(
        `collected spawn ${edge.spawnerFile}:${edge.line} → ${edge.spawnedRole} has no declared spawn edge`,
      );
    }
  }

  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectPipelineShapeViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "pipeline-shape: OK — every declared source exists; every declared spawn edge has a collectSpawnEdges counterpart; every collected spawn between declared nodes has a declared spawn edge.",
    );
    process.exit(0);
  }

  console.error(
    `pipeline-shape: ${violations.length} declared-edge drift violation(s).\n` +
      "Every declared source must exist on disk; every declared spawn edge must have a counterpart among collectSpawnEdges; every collected spawn whose spawner and spawned role are both declared nodes must have a declared spawn edge. Flow and loop edges are outside this check.\n",
  );
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(ROOT_DIR);
}
