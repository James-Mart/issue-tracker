import {
  isSupportingDocKey,
  type SupportingDocKey,
} from "@server/issue-constants";
import type { SupportingDocPreviewTab } from "./supporting-docs";

export type ProjectHomePeer =
  | "structure"
  | "overview"
  | "outlines"
  | "supportingDocs";

export type ProjectHomeSelection = {
  peer: ProjectHomePeer;
  /**
   * Set when `tab` is a supporting-doc key. That key is not an unknown home
   * tab, so it is not rewritten to Structure; the Supporting docs peer owns
   * the redirect.
   */
  legacyDocKey?: SupportingDocKey;
};

/**
 * Home-bar peer for a project-issue `tab` value. Absent and `structure`
 * select Structure. A supporting-doc key stays on Supporting docs. Any other
 * value selects Structure.
 */
export function resolveProjectHomeTab(
  value: string | null,
  previewableKeys: readonly SupportingDocKey[],
): ProjectHomeSelection {
  const hasDocs = previewableKeys.length > 0;
  if (value == null || value === "structure") return { peer: "structure" };
  if (value === "overview" || value === "outlines") return { peer: value };
  if (value === "supportingDocs") {
    // The peer is absent when nothing is previewable, so this value is not
    // a home-bar peer and resolves to Structure.
    return { peer: hasDocs ? "supportingDocs" : "structure" };
  }
  if (isSupportingDocKey(value)) {
    return { peer: "supportingDocs", legacyDocKey: value };
  }
  return { peer: "structure" };
}

/**
 * Search params to write when `tab` is not a canonical home address.
 * Supporting-doc keys are left unchanged. `null` means the URL already is.
 */
export function projectHomeSearchAfterResolve(
  params: URLSearchParams,
  previewableKeys: readonly SupportingDocKey[],
): URLSearchParams | null {
  const raw = params.get("tab");
  if (raw == null) return null;
  if (isSupportingDocKey(raw)) return null;
  if (raw === "overview" || raw === "outlines") return null;
  if (raw === "supportingDocs" && previewableKeys.length > 0) return null;
  const next = new URLSearchParams(params);
  next.delete("tab");
  return next;
}

/**
 * Document the Supporting docs area shows. `doc` wins when it names a
 * previewable doc; otherwise the first previewable doc. A legacy tab key
 * selects that doc when it is previewable, and otherwise the first
 * previewable doc.
 */
export function supportingDocForHome(
  previewable: readonly SupportingDocPreviewTab[],
  selection: ProjectHomeSelection,
  docParam: string | null,
): SupportingDocPreviewTab | undefined {
  if (selection.peer !== "supportingDocs" || previewable.length === 0) {
    return undefined;
  }
  if (selection.legacyDocKey) {
    // The key still belongs to Supporting docs when that doc is not
    // previewable, so the area shows the first previewable doc.
    return (
      previewable.find((doc) => doc.key === selection.legacyDocKey) ??
      previewable[0]
    );
  }
  if (docParam) {
    const chosen = previewable.find((doc) => doc.key === docParam);
    if (chosen) return chosen;
  }
  return previewable[0];
}

/** Browser-tab suffix for the project issue. Structure has none. */
export function projectHomeTitleSuffix(
  tabParam: string | null,
): string | undefined {
  if (tabParam == null || tabParam === "structure") return undefined;
  if (tabParam === "overview") return "Overview";
  if (tabParam === "outlines") return "Outlines";
  if (tabParam === "supportingDocs") return "Supporting docs";
  if (isSupportingDocKey(tabParam)) return "Doc";
  return undefined;
}
