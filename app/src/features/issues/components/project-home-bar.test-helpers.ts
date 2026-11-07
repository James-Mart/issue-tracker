export function homeNav(container: ParentNode): HTMLElement {
  const nav = container.querySelector('nav[aria-label="Project home"]');
  if (!(nav instanceof HTMLElement)) throw new Error("missing project home bar");
  return nav;
}

export function currentHomePeer(container: ParentNode): string | undefined {
  return homeNav(container).querySelector("a[aria-current='page']")?.textContent ?? undefined;
}
