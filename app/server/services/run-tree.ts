import type { ConversationMeta, DelegationRecord } from "../schemas.js";
import { readConversation, readDelegations } from "./conversations.js";
import { IssueError } from "./errors.js";

export type NestedRun = {
  role: string;
  agentId: string;
  delegationId: string;
  parentCallId?: string;
  at: string;
  children: NestedRun[];
};

export type ConversationRunTree = {
  conversationId: string;
  coordinatorLabel: string;
  children: NestedRun[];
};

/** Session-root label: the conversation type on meta, or title when untyped. */
function coordinatorLabel(meta: ConversationMeta): string {
  return meta.channel ?? meta.title;
}

function toNestedRun(record: DelegationRecord): NestedRun {
  return {
    role: record.role,
    agentId: record.agentId,
    delegationId: record.delegationId,
    at: record.at,
    children: [],
    ...(record.parentCallId !== undefined
      ? { parentCallId: record.parentCallId }
      : {}),
  };
}

function nestDelegations(
  records: DelegationRecord[],
  conversationId: string,
): NestedRun[] {
  const nodes = records.map(toNestedRun);
  const byId = new Map(nodes.map((node) => [node.delegationId, node]));
  const children: NestedRun[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const node = nodes[i]!;
    const parentId = record.parentDelegationId;
    if (parentId === undefined) {
      children.push(node);
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      throw new IssueError(
        "validation",
        `delegation "${record.delegationId}" parent "${parentId}" is not in conversation "${conversationId}"`,
      );
    }
    parent.children.push(node);
  }

  return children;
}

/** Session root plus the conversation's nested delegation tree, to any depth. */
export function runTreeForConversation(
  conversationId: string,
): ConversationRunTree {
  const { meta } = readConversation(conversationId);
  return {
    conversationId: meta.id,
    coordinatorLabel: coordinatorLabel(meta),
    children: nestDelegations(readDelegations(conversationId), meta.id),
  };
}
