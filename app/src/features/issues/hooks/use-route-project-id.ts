import { useMatch } from "react-router-dom";

/**
 * The scoped project id for the current route. The app shell (sidebar, top bar)
 * renders above <Routes>, so useParams is empty there — match the project detail
 * and project routes directly instead so the two shell components can't drift.
 */
export function useRouteProjectId(): string | undefined {
  const detailMatch = useMatch("/projects/:projectId/issues/:id");
  const projectMatch = useMatch("/projects/:projectId");
  return detailMatch?.params.projectId ?? projectMatch?.params.projectId;
}
