import { request } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type {
  ConversationActiveRun,
  ConversationListItem,
  ConversationMeta,
  ConversationTranscriptPage,
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
  message?: string;
};

export type UpdateConversationBody = {
  title?: string;
  model?: string;
  archived?: boolean;
};

export function listConversations(
  showArchived = false,
): Promise<ConversationListItem[]> {
  const qs = showArchived ? "?showArchived=true" : "";
  return request<ConversationListItem[]>(`/api/conversations${qs}`);
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
  return request<ConversationActiveRun>(`/api/conversations/${id}/run`);
}

/** Transcript GET is the only client helper that takes this deadline. */
export const TRANSCRIPT_FETCH_TIMEOUT_MS = 10_000;

export function getConversationTranscript(
  id: string,
  sinceSeq?: number,
  signal?: AbortSignal,
): Promise<ConversationTranscriptPage> {
  const qs =
    sinceSeq === undefined ? "" : `?sinceSeq=${encodeURIComponent(String(sinceSeq))}`;
  const timeout = AbortSignal.timeout(TRANSCRIPT_FETCH_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;
  return request<ConversationTranscriptPage>(
    `/api/conversations/${encodeURIComponent(id)}/transcript${qs}`,
    { signal: abort },
  );
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

export type ConversationAttachment = {
  name: string;
  size: number;
  mimeType: string;
};

export function conversationAttachmentApiPath(
  conversationId: string,
  name: string,
): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(name)}`;
}

export function uploadConversationAttachment(
  conversationId: string,
  file: File,
): Promise<ConversationAttachment> {
  const form = new FormData();
  form.append("attachment", file);
  return request<ConversationAttachment>(
    `/api/conversations/${encodeURIComponent(conversationId)}/attachments`,
    { method: "POST", body: form },
  );
}

export function deleteConversationAttachment(
  conversationId: string,
  name: string,
): Promise<void> {
  return request<void>(conversationAttachmentApiPath(conversationId, name), {
    method: "DELETE",
  });
}

export async function listConversationAttachments(
  conversationId: string,
): Promise<ConversationAttachment[]> {
  const data = await request<{ attachments: ConversationAttachment[] }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/attachments`,
  );
  return data.attachments;
}
