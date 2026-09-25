import {
  appendDelegationEnd,
  listConversationIds,
  readDelegations,
} from "./conversations.js";

/** Close every delegation in one conversation that has no end record yet. */
export async function closeOpenDelegationsForConversation(
  conversationId: string,
): Promise<void> {
  const open = readDelegations(conversationId).filter(
    (delegation) => delegation.end === undefined,
  );
  for (const delegation of open) {
    await appendDelegationEnd(conversationId, {
      delegationId: delegation.delegationId,
      status: "error",
      failureClass: "host-process-died",
    });
  }
}

/**
 * Before the server accepts work, end every open delegation from a prior
 * process. One conversation's failure is logged; the scan continues.
 */
export async function closeOpenDelegationsAtBoot(): Promise<void> {
  for (const conversationId of listConversationIds()) {
    try {
      await closeOpenDelegationsForConversation(conversationId);
    } catch (err) {
      console.error(
        `open delegation close failed for conversation ${conversationId}:`,
        err,
      );
    }
  }
}
