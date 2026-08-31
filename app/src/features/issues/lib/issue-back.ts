import { issuePath, projectPath } from "./links";

export type IssueBackEntry =
  | { kind: "cockpit" }
  | { kind: "structure"; projectId: string }
  | { kind: "pipeline"; to: string }
  | { kind: "agents" }
  | { kind: "issue"; projectId: string; issueId: string };

export type IssueBackLocationState = {
  issueBackStack?: IssueBackEntry[];
};

const ISSUE_DETAIL_PATH = /^\/projects\/([^/]+)\/issues\/([^/]+)/;

export function parseIssueDetailLocation(
  pathname: string,
): { projectId: string; issueId: string } | null {
  const match = ISSUE_DETAIL_PATH.exec(pathname);
  if (!match) return null;
  return { projectId: match[1], issueId: match[2] };
}

export function originEntryFromLocation(
  pathname: string,
  search: string,
): IssueBackEntry | null {
  if (pathname === "/") {
    return { kind: "cockpit" };
  }
  const projectMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectMatch) {
    return { kind: "structure", projectId: projectMatch[1] };
  }
  if (
    pathname === "/pipelines" ||
    pathname.startsWith("/pipelines/") ||
    pathname === "/runs" ||
    pathname.startsWith("/runs/") ||
    pathname === "/pipeline" ||
    pathname.startsWith("/pipeline/")
  ) {
    return { kind: "pipeline", to: pathname + search };
  }
  if (pathname === "/agents" || pathname.startsWith("/agents/")) {
    return { kind: "agents" };
  }
  if (ISSUE_DETAIL_PATH.test(pathname)) {
    return null;
  }
  return null;
}

export function pushIssueBack(
  stack: IssueBackEntry[] | undefined,
  entry: IssueBackEntry,
): IssueBackEntry[] {
  return [...(stack ?? []), entry];
}

export function peekIssueBack(
  stack: IssueBackEntry[] | undefined,
): IssueBackEntry | undefined {
  if (!stack?.length) return undefined;
  return stack[stack.length - 1];
}

export function popIssueBack(
  stack: IssueBackEntry[] | undefined,
): IssueBackEntry[] {
  if (!stack?.length) return [];
  return stack.slice(0, -1);
}

export function nextIssueBackStack(
  pathname: string,
  search: string,
  currentStack: IssueBackEntry[] | undefined,
): IssueBackEntry[] | undefined {
  const onScreen = parseIssueDetailLocation(pathname);
  const entry = onScreen
    ? {
        kind: "issue" as const,
        projectId: onScreen.projectId,
        issueId: onScreen.issueId,
      }
    : originEntryFromLocation(pathname, search);
  if (!entry) return undefined;
  return pushIssueBack(currentStack, entry);
}

export function issueBackNavigateState(
  pathname: string,
  search: string,
  currentStack: IssueBackEntry[] | undefined,
): IssueBackLocationState | undefined {
  const stack = nextIssueBackStack(pathname, search, currentStack);
  return stack ? { issueBackStack: stack } : undefined;
}

export function issueBackTo(entry: IssueBackEntry): string {
  switch (entry.kind) {
    case "cockpit":
      return "/";
    case "structure":
      return projectPath(entry.projectId);
    case "pipeline":
      return entry.to;
    case "agents":
      return "/agents";
    case "issue":
      return issuePath(entry.projectId, entry.issueId);
  }
}
