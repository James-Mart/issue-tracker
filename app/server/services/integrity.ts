import {
  PARENT_KINDS,
  type Issue,
  type IssueKind,
  type Problem,
} from "../schemas.js";
import {
  storyDependencyIds,
  epicDependencyIds,
  siblingGroupKey,
} from "../order.js";
import { projectContaining } from "./subtree.js";

function checkDuplicateOrder(
  issues: Issue[],
  byId: Map<string, Issue>,
  problems: Problem[],
): void {
  const buckets = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = siblingGroupKey(issue, byId);
    const bucket = buckets.get(key) ?? [];
    bucket.push(issue);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const seen = new Map<number, string>();
    for (const issue of bucket) {
      const prior = seen.get(issue.order);
      if (prior) {
        problems.push({
          id: issue.id,
          message: `duplicate order ${issue.order} in sibling group (also used by "${prior}")`,
        });
      } else {
        seen.set(issue.order, issue.id);
      }
    }
  }
}

function formatExpectedKinds(expectedKinds: readonly IssueKind[]): string {
  if (expectedKinds.length === 1) return `a ${expectedKinds[0]}`;
  return `one of: ${expectedKinds.join(", ")}`;
}

function checkReferent(
  issue: Issue,
  refId: string,
  expectedKinds: readonly IssueKind[],
  relation: string,
  byId: Map<string, Issue>,
  problems: Problem[],
): void {
  const referent = byId.get(refId);
  if (!referent) {
    problems.push({
      id: issue.id,
      message: `${relation} references unknown issue "${refId}"`,
    });
    return;
  }
  if (!expectedKinds.includes(referent.kind)) {
    problems.push({
      id: issue.id,
      message: `${relation} "${refId}" must be ${formatExpectedKinds(expectedKinds)}, not a ${referent.kind}`,
    });
  }
}

// A referent that must not only be `expectedKind` but also share the referring
// issue's parent: a Story's `stackedOn` peer lives under the same parent
// (Epic or Project), an Epic's `blockedBy` peer in the same Project. Wraps
// `checkReferent` and adds the same-container guard so `stackedOn` and
// `blockedBy` validation stay one shape.
function checkReferentInSameContainer(
  issue: Issue,
  refId: string,
  expectedKind: IssueKind,
  relation: string,
  container: string,
  byId: Map<string, Issue>,
  problems: Problem[],
): void {
  checkReferent(issue, refId, [expectedKind], relation, byId, problems);
  const referent = byId.get(refId);
  const issueParent = "partOf" in issue ? issue.partOf : undefined;
  const referentParent =
    referent && "partOf" in referent ? referent.partOf : undefined;
  if (referent?.kind === expectedKind && referentParent !== issueParent) {
    problems.push({
      id: issue.id,
      message: `${relation} "${refId}" must be in the same ${container}`,
    });
  }
}

function dependencyCycles(
  issues: Issue[],
  byId: Map<string, Issue>,
): Set<string> {
  const edges = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.kind === "story") {
      edges.set(
        issue.id,
        storyDependencyIds(issue).filter(
          (id) => byId.get(id)?.kind === "story",
        ),
      );
    } else if (issue.kind === "epic") {
      edges.set(
        issue.id,
        epicDependencyIds(issue).filter((id) => byId.get(id)?.kind === "epic"),
      );
    }
  }

  const inCycle = new Set<string>();
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    visiting.add(id);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (visiting.has(next)) {
        for (let i = stack.lastIndexOf(next); i < stack.length; i += 1) {
          inCycle.add(stack[i]);
        }
      } else if (!done.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    visiting.delete(id);
    done.add(id);
  };

  for (const id of edges.keys()) if (!done.has(id)) visit(id);
  return inCycle;
}

export function checkIntegrity(issues: Issue[]): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  for (const issue of issues) {
    const expectedParents = PARENT_KINDS[issue.kind];
    if (expectedParents.length > 0 && "partOf" in issue && issue.partOf) {
      checkReferent(
        issue,
        issue.partOf,
        expectedParents,
        "partOf",
        byId,
        problems,
      );
    }
    if (issue.kind === "story" && issue.stackedOn) {
      const parent = byId.get(issue.partOf);
      const container =
        parent?.kind === "project"
          ? "Project"
          : parent?.kind === "epic"
            ? "Epic"
            : "parent";
      checkReferentInSameContainer(
        issue,
        issue.stackedOn,
        "story",
        "stackedOn",
        container,
        byId,
        problems,
      );
    }
    if (issue.kind === "epic") {
      for (const dep of issue.blockedBy) {
        checkReferentInSameContainer(
          issue,
          dep,
          "epic",
          "blockedBy",
          "Project",
          byId,
          problems,
        );
      }
    }
  }

  for (const id of dependencyCycles(issues, byId)) {
    problems.push({
      id,
      message: "part of a stackedOn/blockedBy dependency cycle",
    });
  }

  checkDuplicateOrder(issues, byId, problems);
  checkClosedCatalogLabels(issues, byId, problems);

  return problems;
}

function checkClosedCatalogLabels(
  issues: Issue[],
  byId: Map<string, Issue>,
  problems: Problem[],
): void {
  for (const issue of issues) {
    if (
      issue.kind !== "epic" &&
      issue.kind !== "idea" &&
      issue.kind !== "story"
    ) {
      continue;
    }
    if (!issue.labels?.length) continue;
    const projectId = projectContaining(issue, byId);
    const project = projectId ? byId.get(projectId) : undefined;
    const catalog = new Set(
      project?.kind === "project"
        ? (project.labels ?? []).map((label) => label.id)
        : [],
    );
    for (const labelId of issue.labels) {
      if (!catalog.has(labelId)) {
        problems.push({
          id: issue.id,
          message: `labels references unknown catalog id "${labelId}"`,
        });
      }
    }
  }
}

export function problemsFor(id: string, issues: Issue[]): Problem[] {
  return checkIntegrity(issues).filter((problem) => problem.id === id);
}
