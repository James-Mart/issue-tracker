import { request } from "@/lib/api/client";
import type { ConversationMeta } from "@server/schemas";

export type AgentModel = {
  id: string;
  displayName: string;
};

export type AgentModelsResponse = {
  models: AgentModel[];
};

export type CreateConversationBody = {
  projectId: string;
  model: string;
  title?: string;
};

export type UpdateConversationBody = {
  title?: string;
  model?: string;
};

export function listConversations(): Promise<ConversationMeta[]> {
  return request<ConversationMeta[]>("/api/conversations");
}

export function createConversation(
  body: CreateConversationBody,
): Promise<ConversationMeta> {
  return request<ConversationMeta>("/api/conversations", {
    method: "POST",
    body,
  });
}

export function updateConversation(
  id: string,
  body: UpdateConversationBody,
): Promise<ConversationMeta> {
  return request<ConversationMeta>(`/api/conversations/${id}`, {
    method: "PATCH",
    body,
  });
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${id}`, { method: "DELETE" });
}

export function listAgentModels(): Promise<AgentModelsResponse> {
  return request<AgentModelsResponse>("/api/agent-models");
}

export type SendConversationMessageBody = {
  prompt: string;
  model?: string;
};

export type SendConversationMessageResult = {
  runId: string;
};

export function sendConversationMessage(
  id: string,
  body: SendConversationMessageBody,
): Promise<SendConversationMessageResult> {
  return request<SendConversationMessageResult>(
    `/api/conversations/${id}/messages`,
    { method: "POST", body },
  );
}

export function cancelConversationRun(id: string): Promise<void> {
  return request<void>(`/api/conversations/${id}/cancel`, { method: "POST" });
}
