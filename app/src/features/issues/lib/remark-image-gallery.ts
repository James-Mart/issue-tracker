type MdastNode = {
  type: string;
  children?: MdastNode[];
  value?: string;
  data?: {
    hName?: string;
    hProperties?: Record<string, string | number | boolean>;
  };
};

function isIgnorablePhrasing(node: MdastNode): boolean {
  if (node.type === "break") return true;
  return node.type === "text" && !(node.value ?? "").trim();
}

/** Images in a paragraph that contains nothing else but breaks / whitespace. */
export function imagesFromParagraph(node: MdastNode): MdastNode[] | null {
  if (node.type !== "paragraph" || !node.children) return null;
  const images: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "image") {
      images.push(child);
      continue;
    }
    if (isIgnorablePhrasing(child)) continue;
    return null;
  }
  return images.length > 0 ? images : null;
}

function galleryNode(images: MdastNode[]): MdastNode {
  return {
    type: "gallery",
    data: {
      hName: "div",
      hProperties: {
        className: "issue-md-gallery",
        "data-capture-gallery": "",
      },
    },
    children: images,
  };
}

export function groupImageSiblings(children: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  let pending: MdastNode[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    if (pending.length === 1) {
      out.push({ type: "paragraph", children: pending });
    } else {
      out.push(galleryNode(pending));
    }
    pending = [];
  };

  for (const child of children) {
    const images = imagesFromParagraph(child);
    if (images) {
      pending.push(...images);
      continue;
    }
    flush();
    out.push(child);
  }
  flush();
  return out;
}

function visitParents(node: MdastNode) {
  if (!node.children) return;
  if (node.type === "gallery") return;
  node.children = groupImageSiblings(node.children);
  for (const child of node.children) {
    visitParents(child);
  }
}

/** Wrap consecutive image-only paragraphs (and multi-image paragraphs) as a gallery. */
export function remarkImageGallery() {
  return (tree: MdastNode) => {
    visitParents(tree);
  };
}
