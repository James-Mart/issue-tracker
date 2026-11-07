import { Navigate, useParams, useSearchParams } from "react-router-dom";
import type { ProjectHomePeer } from "./lib/project-home";
import { projectHomeHrefWithParams } from "./lib/project-home";

const LEGACY_HOME_LENSES = ["structure", "overview"] as const;

/** Parse legacy `lens` on `/projects/:id`; unknown or absent → Structure. */
function parseLegacyHomeLens(value: string | null): ProjectHomePeer {
  if (value != null && (LEGACY_HOME_LENSES as readonly string[]).includes(value)) {
    return value as ProjectHomePeer;
  }
  return "structure";
}

/** Canonical project-issue URL for legacy `/projects/:id` addresses. */
export function legacyProjectHomeRedirectTarget(
  projectId: string,
  params: URLSearchParams,
): string {
  const next = new URLSearchParams(params);
  const peer = parseLegacyHomeLens(next.get("lens"));
  next.delete("lens");
  return projectHomeHrefWithParams(projectId, peer, next);
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
