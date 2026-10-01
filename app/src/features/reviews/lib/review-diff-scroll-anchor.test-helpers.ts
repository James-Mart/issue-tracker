/** Places a node at `top` (viewport px) with `height`; call again to move it. */
export function place(node: Element, top: number, height: number) {
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top, bottom: top + height, height }) as DOMRect,
  });
}

/** A Virtualizer scroll element with its content container, 500px tall. */
export function scroller(top = 100): HTMLElement {
  const root = document.createElement("div");
  root.appendChild(document.createElement("div"));
  document.body.appendChild(root);
  place(root, top, 500);
  return root;
}

export function file(root: HTMLElement, path: string, top: number, height: number): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("data-testid", "review-file");
  section.setAttribute("data-file-name", path);
  root.firstElementChild!.appendChild(section);
  place(section, top, height);
  return section;
}

export function diffRows(section: HTMLElement, rows: [index: string, top: number][]): ShadowRoot {
  const host = document.createElement("diffs-container");
  section.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  for (const [index, top] of rows) shadow.appendChild(row(index, top));
  return shadow;
}

export function row(index: string, top: number): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("data-line", "1");
  node.setAttribute("data-line-index", index);
  place(node, top, 20);
  return node;
}

export function thread(section: HTMLElement, id: string, top: number, height: number): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("data-thread-root", id);
  section.appendChild(node);
  place(node, top, height);
  return node;
}
