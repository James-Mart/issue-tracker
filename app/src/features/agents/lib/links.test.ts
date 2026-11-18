import { describe, expect, it } from "vitest";
import {
  agentsCatalogDefaultPath,
  agentsCatalogEntryPath,
  agentsCatalogProfilePath,
  agentsCatalogRolePath,
  isAgentsCatalogPath,
  isChatAreaPath,
} from "./links";

describe("agents catalog paths", () => {
  it("keeps chat and the catalog on separate paths", () => {
    expect(isChatAreaPath("/chat")).toBe(true);
    expect(isChatAreaPath("/chat/abc")).toBe(true);
    expect(isChatAreaPath("/agents")).toBe(false);
    expect(isChatAreaPath("/agents/roles/issue-tracker-research")).toBe(false);
    expect(isAgentsCatalogPath("/agents")).toBe(true);
    expect(isAgentsCatalogPath("/agents/default")).toBe(true);
    expect(isAgentsCatalogPath("/chat")).toBe(false);
  });

  it("builds catalog entry paths from the agents prefix", () => {
    expect(agentsCatalogDefaultPath()).toBe("/agents/default");
    expect(agentsCatalogProfilePath("read-only")).toBe(
      "/agents/profiles/read-only",
    );
    expect(agentsCatalogRolePath("issue-tracker-implementor-grok")).toBe(
      "/agents/roles/issue-tracker-implementor-grok",
    );
    expect(
      agentsCatalogEntryPath({ kind: "profile", id: "read-only" }),
    ).toBe(agentsCatalogProfilePath("read-only"));
  });
});
