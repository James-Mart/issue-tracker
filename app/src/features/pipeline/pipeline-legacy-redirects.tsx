import { Navigate, useLocation, useParams } from "react-router-dom";

export function LegacyPipelineRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/pipelines${search}`} replace />;
}

export function LegacyPipelineRunsRedirect() {
  return <Navigate to="/runs" replace />;
}

export function LegacyPipelineRunRedirect() {
  const { conversationId } = useParams<{ conversationId: string }>();
  return (
    <Navigate
      to={`/runs/${encodeURIComponent(conversationId!)}`}
      replace
    />
  );
}
