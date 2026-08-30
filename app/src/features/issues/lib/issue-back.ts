import { projectPath } from "./links";

export type IssueBackEntry =
  | { kind: "cockpit" }
  | { kind: "structure"; projectId: string };

export type IssueBackLocationState = {
  issueBackStack?: IssueBackEntry[];
};

export function originEntryFromLocation(
  pathname: string,
  _search: string,
): IssueBackEntry | null {
  if (pathname === "/") {
    return { kind: "cockpit" };
  }
  const projectMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectMatch) {
    return { kind: "structure", projectId: projectMatch[1] };
  }
  if (/^\/projects\/[^/]+\/issues\/[^/]+/.test(pathname)) {
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

export function issueBackTo(entry: IssueBackEntry): string {
  if (entry.kind === "cockpit") return "/";
  return projectPath(entry.projectId);
}
