import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { parseOverviewLens } from "./lib/overview-lens";
import { locationWithSearch, projectHomePeerHref } from "./lib/project-home";

/** Canonical project-issue URL for legacy `/projects/:id` addresses. */
export function legacyProjectHomeRedirectTarget(
  projectId: string,
  params: URLSearchParams,
): string {
  const next = new URLSearchParams(params);
  const lens = next.get("lens");
  next.delete("lens");
  const peer =
    parseOverviewLens(lens) === "overview" ? "overview" : "structure";
  const href = projectHomePeerHref(projectId, peer);
  const queryStart = href.indexOf("?");
  const pathname = queryStart === -1 ? href : href.slice(0, queryStart);
  const merged = new URLSearchParams(
    queryStart === -1 ? "" : href.slice(queryStart + 1),
  );
  for (const [key, value] of next) {
    merged.set(key, value);
  }
  const { search } = locationWithSearch({ pathname, hash: "" }, merged);
  return `${pathname}${search}`;
}

export function LegacyProjectHomeRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  return (
    <Navigate
      to={legacyProjectHomeRedirectTarget(projectId!, searchParams)}
      replace
    />
  );
}
