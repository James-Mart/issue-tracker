import type { SDKCustomToolResult } from "@cursor/sdk";
import type { DelegateResult } from "./delegate-tool.js";

type DelegationEnd = {
  status: "completed" | "error";
  endedAt: string;
  failureClass?: string;
};

type DelegationRow = {
  delegationId: string;
  agentId: string;
  role: string;
  model: string;
  at: string;
  parentDelegationId?: string;
  end?: DelegationEnd;
};

type DelegationsListing = {
  root: { agentId: string };
  delegations: DelegationRow[];
};

export function isDelegateResult(
  result: SDKCustomToolResult,
): result is DelegateResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    typeof result.ok === "boolean" &&
    "agentId" in result &&
    typeof result.agentId === "string"
  );
}

export function delegateResultOf(result: SDKCustomToolResult): DelegateResult {
  if (!isDelegateResult(result)) throw new Error("expected a delegate result");
  return result;
}

function isDelegationsListing(
  result: SDKCustomToolResult,
): result is DelegationsListing {
  return (
    typeof result === "object" &&
    result !== null &&
    "root" in result &&
    "delegations" in result &&
    Array.isArray(result.delegations)
  );
}

export function delegationsListingOf(
  result: SDKCustomToolResult,
): DelegationsListing {
  if (!isDelegationsListing(result)) {
    throw new Error("expected a delegations listing");
  }
  return result;
}
