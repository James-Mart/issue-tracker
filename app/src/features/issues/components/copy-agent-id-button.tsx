import { CopyTextButton } from "./copy-text-button";

/** Ghost icon control for the conversation root agent id (same feedback as issue id copy). */
export function CopyAgentIdButton({ agentId }: { agentId: string }) {
  return (
    <CopyTextButton
      text={agentId}
      label="Copy agent id"
      testId="copy-root-agent-id"
      className="shrink-0 text-muted-foreground"
    />
  );
}