import { Navigate, useParams } from "react-router-dom";
import { CHAT_PATH, chatConversationPath } from "./lib/links";

export function LegacyAgentsRedirect() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const to = conversationId
    ? chatConversationPath(conversationId)
    : CHAT_PATH;
  return <Navigate to={to} replace />;
}