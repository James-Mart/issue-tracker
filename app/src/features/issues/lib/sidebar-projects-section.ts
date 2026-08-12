const SIDEBAR_PROJECTS_SECTION_COOKIE_NAME = "sidebar_projects_section_open";
/** Same retention as `sidebar_state` in the app sidebar provider. */
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function readSidebarCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match?.[1];
}

export function readSidebarProjectsSectionOpen(): boolean {
  const value = readSidebarCookie(SIDEBAR_PROJECTS_SECTION_COOKIE_NAME);
  if (value === undefined) return true;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    `Invalid ${SIDEBAR_PROJECTS_SECTION_COOKIE_NAME} cookie: ${value}`,
  );
}

export function writeSidebarProjectsSectionOpen(open: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_PROJECTS_SECTION_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
}
