/** Parse module script srcs from HTML (dev index.html or Vite-built dist). */
export function productionModuleScriptSrcs(html: string): string[] {
  const srcs: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const open = match[0];
    if (!/\btype=["']module["']/.test(open)) continue;
    const src = open.match(/\bsrc=["']([^"']+)["']/);
    if (src) srcs.push(src[1]);
  }
  return srcs;
}

/**
 * Production HTML must load bootstrap-fault as its own module, not only the
 * main app chunk — otherwise aborting the app bundle leaves #root blank.
 */
export function independentBootstrapFaultEntryProblem(
  html: string,
): string | undefined {
  const srcs = productionModuleScriptSrcs(html);
  const fault = srcs.filter((src) => src.includes("bootstrap-fault"));
  const rest = srcs.filter((src) => !src.includes("bootstrap-fault"));
  if (fault.length === 0 || rest.length === 0) {
    return `bootstrap-fault must remain a separate production module (scripts: ${srcs.join(", ") || "(none)"})`;
  }
  return undefined;
}
