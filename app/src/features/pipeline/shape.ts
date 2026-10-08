// The declared shape of the harness's own pipelines — the single source of
// truth a design diagram draws from.
//
// Pure data with no imports: server code and the `lint:pipeline-shape` script
// read this module, so it must never reach into `@server/` (that direction is
// what `npm run lint:boundary` bans — Node builtins and the zod package).
//
// `source` is the plugin-relative path of the `agents/*.md` or
// `skills/*/SKILL.md` file that defines the step, which is how the drift guard
// matches a declared `spawn` edge to a spawn stub in the harness's prose.

export type PipelineId = "planning" | "work";

/**
 * `step` and `gate` stand for a beat with a defining file; `handoff` stands for
 * the seam where one pipeline hands off to another.
 */
export type PipelineNodeKind = "step" | "gate" | "handoff";

/**
 * `spawn` is the only kind the drift guard can cross-check — sequencing and
 * feedback have no spawn-stub form in the prose to parse.
 */
export type PipelineEdgeKind = "spawn" | "flow" | "loop";

interface PipelineNodeBase {
  id: string;
  /** The name the harness itself uses — never abbreviated to fit a screen. */
  name: string;
  /** Narrow-width stand-in for `name`. */
  shortLabel?: string;
  pipeline: PipelineId;
}

export interface PipelineStepNode extends PipelineNodeBase {
  kind: "step" | "gate";
  source: string;
}

export interface PipelineHandoffNode extends PipelineNodeBase {
  kind: "handoff";
  targetPipeline: PipelineId;
}

export type PipelineNode = PipelineStepNode | PipelineHandoffNode;

export interface PipelineEdge {
  from: string;
  to: string;
  kind: PipelineEdgeKind;
}

export interface Pipeline {
  id: PipelineId;
  title: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

const PLAN_SKILL = "skills/issue-tracker-plan/SKILL.md";
const POLISH_SKILL = "skills/issue-tracker-plan-polish/SKILL.md";

const planning: Pipeline = {
  id: "planning",
  title: "Planning",
  nodes: [
    {
      id: "grill",
      name: "Grill-me protocol",
      shortLabel: "Grill",
      kind: "step",
      pipeline: "planning",
      source: PLAN_SKILL,
    },
    {
      id: "research",
      name: "Focused codebase research",
      shortLabel: "Research",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-research.md",
    },
    {
      id: "mockup-round",
      name: "Mockup round",
      kind: "step",
      pipeline: "planning",
      source: "skills/issue-tracker-mockup/SKILL.md",
    },
    {
      id: "design-conformance",
      name: "Design conformance",
      shortLabel: "Conformance",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-design-conformance.md",
    },
    {
      id: "mockup-author",
      name: "Mockup author",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-mockup-author.md",
    },
    {
      id: "outline-gate",
      name: "Single post-outline gate",
      shortLabel: "Outline gate",
      kind: "gate",
      pipeline: "planning",
      source: PLAN_SKILL,
    },
    {
      id: "migrate",
      name: "Migrate",
      kind: "step",
      pipeline: "planning",
      source: "skills/issue-tracker-plan/references/migrate.md",
    },
    {
      id: "polish",
      name: "Plan polish",
      kind: "step",
      pipeline: "planning",
      source: POLISH_SKILL,
    },
    {
      id: "check-dry",
      name: "DRY",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-dry.md",
    },
    {
      id: "check-authoring-conformance",
      name: "Authoring conformance",
      shortLabel: "Authoring",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-authoring-conformance.md",
    },
    {
      id: "check-dependency-order",
      name: "Dependency order",
      shortLabel: "Deps order",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-dependency-order.md",
    },
    {
      id: "check-internal-consistency",
      name: "Internal consistency",
      shortLabel: "Consistency",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-internal-consistency.md",
    },
    {
      id: "check-footprint",
      name: "Footprint",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-footprint.md",
    },
    {
      id: "polish-apply",
      name: "Aggregate → apply → summary",
      shortLabel: "Apply",
      kind: "step",
      pipeline: "planning",
      source:
        "skills/issue-tracker-plan-polish/references/aggregate-apply-summary.md",
    },
    {
      id: "copyedit",
      name: "Copyedit",
      kind: "step",
      pipeline: "planning",
      source: "agents/issue-tracker-plan-copyedit.md",
    },
    {
      id: "work-handoff",
      name: "Work the stack",
      shortLabel: "Work",
      kind: "handoff",
      pipeline: "planning",
      targetPipeline: "work",
    },
  ],
  edges: [
    { from: "grill", to: "research", kind: "spawn" },
    { from: "grill", to: "mockup-round", kind: "flow" },
    { from: "mockup-round", to: "design-conformance", kind: "spawn" },
    { from: "design-conformance", to: "mockup-author", kind: "spawn" },
    { from: "mockup-round", to: "outline-gate", kind: "flow" },
    { from: "outline-gate", to: "migrate", kind: "flow" },
    { from: "migrate", to: "polish", kind: "flow" },
    { from: "polish", to: "check-dry", kind: "spawn" },
    { from: "polish", to: "check-authoring-conformance", kind: "spawn" },
    { from: "polish", to: "check-dependency-order", kind: "spawn" },
    { from: "polish", to: "check-internal-consistency", kind: "spawn" },
    { from: "polish", to: "check-footprint", kind: "spawn" },
    { from: "check-dry", to: "polish-apply", kind: "flow" },
    { from: "check-authoring-conformance", to: "polish-apply", kind: "flow" },
    { from: "check-dependency-order", to: "polish-apply", kind: "flow" },
    { from: "check-internal-consistency", to: "polish-apply", kind: "flow" },
    { from: "check-footprint", to: "polish-apply", kind: "flow" },
    // Re-check round: an apply re-enters every check agent that had findings.
    { from: "polish-apply", to: "polish", kind: "loop" },
    // Copyedit runs once after the loop exits (aggregate-apply-summary step 6).
    { from: "polish-apply", to: "copyedit", kind: "spawn" },
    { from: "copyedit", to: "work-handoff", kind: "flow" },
  ],
};

const work: Pipeline = {
  id: "work",
  title: "Work the stack",
  nodes: [
    {
      id: "implement",
      name: "Implementor",
      kind: "step",
      pipeline: "work",
      source: "agents/_issue-tracker-implementor.md",
    },
    {
      id: "record-commit",
      name: "Record commit",
      kind: "step",
      pipeline: "work",
      source: "agents/issue-tracker-git.md",
    },
    {
      id: "ui-look",
      name: "UI look",
      kind: "gate",
      pipeline: "work",
      source: "agents/_issue-tracker-ui-look.md",
    },
    {
      id: "review-coding-standards",
      name: "Coding standards review",
      shortLabel: "Standards",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-review-coding-standards.md",
    },
    {
      id: "review-design-system",
      name: "Design system review",
      shortLabel: "Design system",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-review-design-system.md",
    },
    {
      id: "review-duplication",
      name: "Duplication review",
      shortLabel: "Duplication",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-review-duplication.md",
    },
    {
      id: "review-structure",
      name: "Structure review",
      shortLabel: "Structure",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-review-structure.md",
    },
    {
      id: "review-idiom",
      name: "Idiom review",
      shortLabel: "Idiom",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-review-idiom.md",
    },
    {
      id: "story-review",
      name: "Story review",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-story-review.md",
    },
    {
      id: "runtime-validator",
      name: "Runtime validator",
      shortLabel: "Runtime",
      kind: "gate",
      pipeline: "work",
      source: "agents/issue-tracker-runtime-validator.md",
    },
    {
      id: "finish",
      name: "Finish branch",
      kind: "step",
      pipeline: "work",
      source: "agents/issue-tracker-git.md",
    },
    {
      id: "retro",
      name: "Confusion Retro",
      shortLabel: "Retro",
      kind: "step",
      pipeline: "work",
      source: "skills/issue-tracker-retro/SKILL.md",
    },
    {
      id: "planning-handoff",
      name: "Planning",
      kind: "handoff",
      pipeline: "work",
      targetPipeline: "planning",
    },
  ],
  edges: [
    { from: "implement", to: "record-commit", kind: "spawn" },
    // Each reviewer returns its findings to the implementor, as
    // `record-commit` does, so none has an edge of its own onward.
    { from: "implement", to: "review-coding-standards", kind: "spawn" },
    // Spawned only for a UI-related Task.
    { from: "implement", to: "review-design-system", kind: "spawn" },
    { from: "implement", to: "review-duplication", kind: "spawn" },
    { from: "implement", to: "review-structure", kind: "spawn" },
    { from: "implement", to: "review-idiom", kind: "spawn" },
    // The look runs inside the implementor's self-check on a UI-related
    // Task; other Tasks go straight to Story review.
    { from: "implement", to: "ui-look", kind: "flow" },
    { from: "ui-look", to: "story-review", kind: "flow" },
    { from: "implement", to: "story-review", kind: "flow" },
    // Runs only for a Story with runtime-visible behavior and no diff gaps.
    { from: "story-review", to: "runtime-validator", kind: "spawn" },
    // A reopened review sends remediation Tasks back through the Task cycle.
    { from: "story-review", to: "implement", kind: "loop" },
    { from: "story-review", to: "finish", kind: "flow" },
    { from: "finish", to: "retro", kind: "flow" },
    { from: "retro", to: "planning-handoff", kind: "flow" },
  ],
};

export const pipelines: Pipeline[] = [planning, work];

/** Node ids a pipeline spawns from its polish step, in edge order. */
export function polishCheckIds(pipeline: Pipeline): string[] {
  return pipeline.edges
    .filter((edge) => edge.from === "polish" && edge.kind === "spawn")
    .map((edge) => edge.to);
}
