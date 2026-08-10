import { request } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  parseConversationActiveRun,
  parseConversationListItem,
  parseConversationTranscriptPage,
  type ConversationActiveRun,
  type ConversationListItem,
  type ConversationMeta,
  type ConversationTranscriptPage,
} from "@server/schemas";

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
  archived?: boolean;
};

function parseConversationList(raw: unknown): ConversationListItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("invalid conversations list");
  }
  return raw.map((entry) => {
    const parsed = parseConversationListItem(entry);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.item;
  });
}

export function listConversations(
  showArchived = false,
): Promise<ConversationListItem[]> {
  const qs = showArchived ? "?showArchived=true" : "";
  return request<unknown>(`/api/conversations${qs}`).then(parseConversationList);
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

export function getConversationRun(id: string): Promise<ConversationActiveRun> {
  return request<unknown>(`/api/conversations/${id}/run`).then((raw) => {
    const parsed = parseConversationActiveRun(raw);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.state;
  });
}

export function getConversationTranscript(
  id: string,
  sinceSeq?: number,
): Promise<ConversationTranscriptPage> {
  const qs =
    sinceSeq === undefined ? "" : `?sinceSeq=${encodeURIComponent(String(sinceSeq))}`;
  return request<unknown>(
    `/api/conversations/${encodeURIComponent(id)}/transcript${qs}`,
  ).then((raw) => {
    const parsed = parseConversationTranscriptPage(raw);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.page;
  });
}

export function listAgentModels(): Promise<AgentModelsResponse> {
  return request<AgentModelsResponse>("/api/agent-models");
}

export type SendConversationMessageBody = {
  prompt: string;
  model?: string;
};

export type SendConversationMessageResult = {
  runId?: string;
  pending?: boolean;
};

export type UpdateConversationPendingBody = {
  text: string;
};

export function updateConversationPending(
  id: string,
  body: UpdateConversationPendingBody,
): Promise<ConversationMeta> {
  return request<ConversationMeta>(`/api/conversations/${id}/pending`, {
    method: "PATCH",
    body,
  });
}

export function clearConversationPending(id: string): Promise<void> {
  return request<void>(`/api/conversations/${id}/pending`, { method: "DELETE" });
}

export function sendConversationMessage(
  id: string,
  body: SendConversationMessageBody,
): Promise<SendConversationMessageResult> {
  return request<SendConversationMessageResult>(
    `/api/conversations/${id}/messages`,
    { method: "POST", body },
  );
}

export async function cancelConversationRun(id: string): Promise<void> {
  try {
    await request<void>(`/api/conversations/${id}/cancel`, { method: "POST" });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return;
    throw err;
  }
}

export type InterruptConversationRunBody = SendConversationMessageBody;

export type InterruptConversationRunResult = {
  runId: string;
};

export function interruptConversationRun(
  id: string,
  body: InterruptConversationRunBody,
): Promise<InterruptConversationRunResult> {
  return request<InterruptConversationRunResult>(
    `/api/conversations/${id}/interrupt`,
    { method: "POST", body },
  );
}
