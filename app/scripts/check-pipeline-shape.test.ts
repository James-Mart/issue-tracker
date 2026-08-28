import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pipeline } from "../src/features/pipeline/shape.js";
import { collectPipelineShapeViolations } from "./check-pipeline-shape.js";

let rootDir: string;
let agentsDir: string;
let skillsDir: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

function writeSkill(relPath: string, content: string): void {
  const full = join(skillsDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

const fixturePipelines: Pipeline[] = [
  {
    id: "planning",
    title: "Planning",
    nodes: [
      {
        id: "grill",
        name: "Grill",
        kind: "step",
        pipeline: "planning",
        source: "skills/plan/SKILL.md",
      },
      {
        id: "research",
        name: "Research",
        kind: "step",
        pipeline: "planning",
        source: "agents/research.md",
      },
      {
        id: "author",
        name: "Author",
        kind: "step",
        pipeline: "planning",
        source: "agents/author.md",
      },
    ],
    edges: [
      { from: "grill", to: "research", kind: "spawn" },
      { from: "research", to: "author", kind: "flow" },
    ],
  },
];

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-pipeline-shape-lint-"));
  agentsDir = join(rootDir, "agents");
  skillsDir = join(rootDir, "skills");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("collectPipelineShapeViolations", () => {
  it("fails when a declared source does not exist on disk", () => {
    writeAgent("research.md", "# research\n");
    writeAgent("author.md", "# author\n");
    writeSkill(
      "plan/SKILL.md",
      "**Research** — `role: research`\n",
    );

    const pipelines: Pipeline[] = [
      {
        ...fixturePipelines[0]!,
        nodes: [
          ...fixturePipelines[0]!.nodes,
          {
            id: "missing",
            name: "Missing",
            kind: "step",
            pipeline: "planning",
            source: "agents/missing.md",
          },
        ],
      },
    ];

    const violations = collectPipelineShapeViolations(rootDir, pipelines);
    expect(
      violations.some((v) =>
        v.includes("declared source 'agents/missing.md' (node 'missing') does not exist"),
      ),
    ).toBe(true);
  });

  it("fails when a declared spawn edge has no collectSpawnEdges counterpart", () => {
    writeAgent("research.md", "# research\n");
    writeAgent("author.md", "# author\n");
    writeSkill("plan/SKILL.md", "# plan\n");

    const violations = collectPipelineShapeViolations(rootDir, fixturePipelines);
    expect(
      violations.some((v) =>
        v.includes(
          "declared spawn grill → research has no counterpart among collectSpawnEdges",
        ),
      ),
    ).toBe(true);
  });

  it("fails when a collected spawn between declared nodes has no declared spawn edge", () => {
    writeAgent("research.md", "# research\n");
    writeAgent("author.md", "# author\n");
    writeSkill(
      "plan/SKILL.md",
      [
        "**Research** — `role: research`",
        "",
        "**Author** — `role: author`",
      ].join("\n"),
    );

    const violations = collectPipelineShapeViolations(rootDir, fixturePipelines);
    expect(
      violations.some((v) =>
        v.includes(
          "collected spawn skills/plan/SKILL.md:",
        ) && v.includes("→ author has no declared spawn edge"),
      ),
    ).toBe(true);
    expect(
      violations.some((v) =>
        v.includes("declared spawn grill → research has no counterpart"),
      ),
    ).toBe(false);
  });

  it("does not fail a flow edge that has no prose counterpart", () => {
    writeAgent("research.md", "# research\n");
    writeAgent("author.md", "# author\n");
    writeSkill(
      "plan/SKILL.md",
      "**Research** — `role: research`\n",
    );

    expect(collectPipelineShapeViolations(rootDir, fixturePipelines)).toEqual(
      [],
    );
  });
});
