import {
  isSupportingDocKey,
  type SupportingDocKey,
} from "@server/issue-constants";
import { issuePath } from "./links";
import type { SupportingDocPreviewTab } from "./supporting-docs";

export type ProjectHomePeer =
  | "structure"
  | "overview"
  | "outlines"
  | "supportingDocs";

export type ProjectHomeBarActive = ProjectHomePeer | "review";

export const PROJECT_HOME_PEER_LABELS: Record<ProjectHomePeer, string> = {
  structure: "Structure",
  overview: "Overview",
  outlines: "Outlines",
  supportingDocs: "Supporting docs",
};

export function projectHomePeerHref(
  projectId: string,
  peer: ProjectHomePeer,
): string {
  const base = issuePath(projectId, projectId);
  if (peer === "structure") return base;
  return `${base}?tab=${peer}`;
}

export type ProjectHomeSelection = {
  peer: ProjectHomePeer;
  /**
   * Set when `tab` is still a supporting-doc key. That address belongs to
   * Supporting docs, which rewrites it to `tab=supportingDocs`.
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
 * Canonical project-home search. A previewable supporting-doc key becomes
 * `tab=supportingDocs` with `doc` set to that key. A supporting-doc key that
 * is not previewable becomes Supporting docs with no `doc` when any doc
 * previews, and Structure when none do. On Supporting docs, `doc` stays when
 * it names a previewable doc and is removed otherwise. `doc` is removed on
 * every other peer. Other parameters stay. `null` means `params` is already
 * canonical.
 */
export function projectHomeSearchAfterResolve(
  params: URLSearchParams,
  previewableKeys: readonly SupportingDocKey[],
): URLSearchParams | null {
  const raw = params.get("tab");
  const next = new URLSearchParams(params);
  let changed = false;
  const assign = (key: string, value: string | null) => {
    if (value == null) {
      if (!next.has(key)) return;
      next.delete(key);
      changed = true;
      return;
    }
    if (next.get(key) === value) return;
    next.set(key, value);
    changed = true;
  };

  const onSupportingDocs =
    raw === "supportingDocs" && previewableKeys.length > 0;
  if (raw != null && isSupportingDocKey(raw)) {
    if (previewableKeys.includes(raw)) {
      assign("tab", "supportingDocs");
      assign("doc", raw);
    } else if (previewableKeys.length > 0) {
      assign("tab", "supportingDocs");
      assign("doc", null);
    } else {
      assign("tab", null);
      assign("doc", null);
    }
  } else if (raw === "overview" || raw === "outlines") {
    assign("doc", null);
  } else if (!onSupportingDocs) {
    assign("tab", null);
    assign("doc", null);
  } else {
    const doc = next.get("doc");
    if (
      doc != null &&
      (!isSupportingDocKey(doc) || !previewableKeys.includes(doc))
    ) {
      assign("doc", null);
    }
  }

  return changed ? next : null;
}

/** Supporting docs search with `doc` set to `key`. Other parameters stay. */
export function supportingDocSearch(
  params: URLSearchParams,
  key: SupportingDocKey,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("tab", "supportingDocs");
  next.set("doc", key);
  return next;
}

/**
 * Same path and hash, with the query taken from `params`.
 * Callers use this where a search-only navigation would drop the hash.
 */
export function locationWithSearch(
  location: { pathname: string; hash: string },
  params: URLSearchParams,
): { pathname: string; search: string; hash: string } {
  const search = params.toString();
  return {
    pathname: location.pathname,
    search: search ? `?${search}` : "",
    hash: location.hash,
  };
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
  if (tabParam === "supportingDocs" || isSupportingDocKey(tabParam)) {
    return "Supporting docs";
  }
  return undefined;
}
