import { describe, expect, it } from "vitest";
import {
  emptySupportingDocDraft,
  formatSupportingDocRef,
  isSupportingDocDraftReady,
  previewableSupportingDocs,
  supportingDocContentUrl,
  supportingDocDraftForMode,
  supportingDocDraftFromRef,
  supportingDocPreviewFormat,
  supportingDocRefFromDraft,
  supportingDocsDraftFromIssue,
  supportingDocsEqual,
  supportingDocsFromDraft,
  supportingDocsFromDraftPreservingIncomplete,
  workspaceFileApiPath,
} from "./supporting-docs";

describe("formatSupportingDocRef", () => {
  it("formats attachment and workspace refs", () => {
    expect(
      formatSupportingDocRef({ type: "attachment", name: "vision.md" }),
    ).toBe("attachment:vision.md");
    expect(
      formatSupportingDocRef({ type: "workspace", path: "docs/vision.md" }),
    ).toBe("workspace:docs/vision.md");
  });
});

describe("supportingDocDraftFromRef / supportingDocRefFromDraft", () => {
  it("round-trips attachment and workspace refs", () => {
    const attachment = { type: "attachment" as const, name: "vision.md" };
    const workspace = { type: "workspace" as const, path: "docs/standards.md" };
    expect(supportingDocRefFromDraft(supportingDocDraftFromRef(attachment))).toEqual(
      attachment,
    );
    expect(supportingDocRefFromDraft(supportingDocDraftFromRef(workspace))).toEqual(
      workspace,
    );
    expect(supportingDocRefFromDraft(supportingDocDraftFromRef(undefined))).toBeUndefined();
  });

  it("treats blank attachment/workspace values as absent", () => {
    expect(
      supportingDocRefFromDraft({ mode: "attachment", name: "  " }),
    ).toBeUndefined();
    expect(
      supportingDocRefFromDraft({ mode: "workspace", path: "  " }),
    ).toBeUndefined();
    expect(supportingDocRefFromDraft(emptySupportingDocDraft())).toBeUndefined();
  });
});

describe("supportingDocDraftForMode", () => {
  it("returns a fresh draft without stale sibling fields", () => {
    expect(supportingDocDraftForMode("absent")).toEqual({ mode: "absent" });
    expect(supportingDocDraftForMode("attachment")).toEqual({
      mode: "attachment",
      name: "",
    });
    expect(supportingDocDraftForMode("workspace")).toEqual({
      mode: "workspace",
      path: "",
    });
  });
});

describe("supportingDocsFromDraft", () => {
  it("omits absent keys and returns null when all absent", () => {
    const draft = supportingDocsDraftFromIssue(undefined);
    expect(supportingDocsFromDraft(draft)).toBeNull();

    draft.vision = { mode: "attachment", name: "vision.md" };
    draft.codingStandards = {
      mode: "workspace",
      path: "testdata/supporting-docs/sample.md",
    };
    expect(supportingDocsFromDraft(draft)).toEqual({
      vision: { type: "attachment", name: "vision.md" },
      codingStandards: {
        type: "workspace",
        path: "testdata/supporting-docs/sample.md",
      },
    });
  });
});

describe("isSupportingDocDraftReady / supportingDocsFromDraftPreservingIncomplete", () => {
  it("treats absent and resolvable drafts as ready", () => {
    expect(isSupportingDocDraftReady({ mode: "absent" })).toBe(true);
    expect(
      isSupportingDocDraftReady({ mode: "attachment", name: "vision.md" }),
    ).toBe(true);
    expect(
      isSupportingDocDraftReady({ mode: "workspace", path: "docs/a.md" }),
    ).toBe(true);
    expect(isSupportingDocDraftReady({ mode: "attachment", name: "" })).toBe(
      false,
    );
    expect(isSupportingDocDraftReady({ mode: "workspace", path: "  " })).toBe(
      false,
    );
  });

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

  it("clears a ready absent key even when persisted", () => {
    const persisted = {
      vision: { type: "attachment" as const, name: "old.md" },
    };
    const draft = supportingDocsDraftFromIssue(persisted);
    draft.vision = { mode: "absent" };
    expect(
      supportingDocsFromDraftPreservingIncomplete(draft, persisted),
    ).toBeNull();
  });
});

describe("supportingDocsEqual", () => {
  it("treats undefined and null as equal empty", () => {
    expect(supportingDocsEqual(undefined, null)).toBe(true);
    expect(
      supportingDocsEqual(
        { vision: { type: "attachment", name: "a.md" } },
        { vision: { type: "attachment", name: "a.md" } },
      ),
    ).toBe(true);
    expect(
      supportingDocsEqual(
        { vision: { type: "attachment", name: "a.md" } },
        { vision: { type: "attachment", name: "b.md" } },
      ),
    ).toBe(false);
  });
});

describe("supporting-doc preview tabs", () => {
  const attachmentMd = { type: "attachment" as const, name: "sample.md" };
  const attachmentHtml = {
    type: "attachment" as const,
    name: "sample-attach.html",
  };
  const workspaceHtml = {
    type: "workspace" as const,
    path: "workspace/sample.html",
  };

  it("classifies the three fixture types for preview", () => {
    expect(supportingDocPreviewFormat(attachmentMd)).toBe("md");
    expect(supportingDocPreviewFormat(attachmentHtml)).toBe("html");
    expect(supportingDocPreviewFormat(workspaceHtml)).toBe("html");
    expect(
      supportingDocPreviewFormat({
        type: "workspace",
        path: "notes.txt",
      }),
    ).toBeNull();
  });

  it("builds content URLs for attachment and workspace fixtures", () => {
    expect(supportingDocContentUrl("p", attachmentMd)).toBe(
      "/api/issues/p/attachments/sample.md",
    );
    expect(supportingDocContentUrl("p", attachmentHtml)).toBe(
      "/api/issues/p/attachments/sample-attach.html",
    );
    expect(supportingDocContentUrl("p", workspaceHtml)).toBe(
      "/api/projects/p/workspace/workspace/sample.html",
    );
    expect(workspaceFileApiPath("p", "workspace/sample-asset.svg")).toBe(
      "/api/projects/p/workspace/workspace/sample-asset.svg",
    );
    // Path segments stay as `/` so iframe-relative assets resolve beside the HTML.
    expect(
      supportingDocContentUrl("p", workspaceHtml).replace(
        /sample\.html$/,
        "sample-asset.svg",
      ),
    ).toBe("/api/projects/p/workspace/workspace/sample-asset.svg");
  });

  it("lists preview tabs in key order and skips empty / non-previewable", () => {
    expect(previewableSupportingDocs(undefined)).toEqual([]);
    expect(previewableSupportingDocs({})).toEqual([]);
    expect(
      previewableSupportingDocs({
        designSystem: workspaceHtml,
        vision: attachmentMd,
        codingStandards: attachmentHtml,
      }).map((tab) => ({
        key: tab.key,
        label: tab.label,
        format: tab.format,
        url: supportingDocContentUrl("p", tab.ref),
      })),
    ).toEqual([
      {
        key: "vision",
        label: "Vision",
        format: "md",
        url: "/api/issues/p/attachments/sample.md",
      },
      {
        key: "codingStandards",
        label: "Coding standards",
        format: "html",
        url: "/api/issues/p/attachments/sample-attach.html",
      },
      {
        key: "designSystem",
        label: "Design system",
        format: "html",
        url: "/api/projects/p/workspace/workspace/sample.html",
      },
    ]);
    expect(
      previewableSupportingDocs({
        vision: { type: "attachment", name: "notes.txt" },
      }),
    ).toEqual([]);
  });
});
