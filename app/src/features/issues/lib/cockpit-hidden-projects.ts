const COCKPIT_HIDDEN_PROJECT_IDS_COOKIE_NAME = "cockpit_hidden_project_ids";
const COCKPIT_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function readCockpitCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(
    new RegExp(
      `(?:^|; )${COCKPIT_HIDDEN_PROJECT_IDS_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`,
    ),
  );
  return match?.[1];
}

export function readCockpitHiddenProjectIds(): string[] {
  if (typeof document === "undefined") return [];
  const value = readCockpitCookie();
  if (value === undefined || value === "") return [];
  return value
    .split(",")
    .filter((token) => token.length > 0)
    .map((token) => decodeURIComponent(token));
}

export function writeCockpitHiddenProjectIds(ids: string[]): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COCKPIT_HIDDEN_PROJECT_IDS_COOKIE_NAME}=${ids.map(encodeURIComponent).join(",")}; path=/; max-age=${COCKPIT_COOKIE_MAX_AGE}`;
}

export function toggleCockpitHiddenProjectId(
  hidden: readonly string[],
  projectId: string,
): string[] {
  if (hidden.includes(projectId)) {
    return hidden.filter((id) => id !== projectId);
  }
  return [...hidden, projectId];
}
