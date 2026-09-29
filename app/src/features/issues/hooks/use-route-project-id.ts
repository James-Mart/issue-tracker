import { useMatch } from "react-router-dom";

/**
 * The scoped project id for the current route. The app shell (sidebar, top bar)
 * renders above <Routes>, so useParams is empty there — match the project,
 * issue, and review routes directly so the shell stays on the project.
 */
export function useRouteProjectId(): string | undefined {
  const match = useMatch({ path: "/projects/:projectId", end: false });
  return match?.params.projectId;
}
