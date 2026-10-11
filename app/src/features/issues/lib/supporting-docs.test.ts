import { describe, expect, it } from "vitest";
import {
  supportingDocsDraftFromIssue,
  supportingDocsFromDraftPreservingIncomplete,
} from "./supporting-docs";

describe("supportingDocsFromDraftPreservingIncomplete", () => {
  it("keeps persisted pointers for incomplete keys", () => {
    const persisted = {
      vision: { type: "attachment" as const, name: "old.md" },
      codingStandards: {
        type: "workspace" as const,
        path: "docs/standards.md",
      },
    };
    const draft = supportingDocsDraftFromIssue(persisted);
    draft.vision = { mode: "workspace", path: "" };
    draft.designSystem = { mode: "attachment", name: "design.md" };

    expect(
      supportingDocsFromDraftPreservingIncomplete(draft, persisted),
    ).toEqual({
      vision: { type: "attachment", name: "old.md" },
      codingStandards: {
        type: "workspace",
        path: "docs/standards.md",
      },
      designSystem: { type: "attachment", name: "design.md" },
    });
  });
});
