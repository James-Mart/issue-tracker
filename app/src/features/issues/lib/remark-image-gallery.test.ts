import { describe, expect, it } from "vitest";
import {
  groupImageSiblings,
  imagesFromParagraph,
  remarkImageGallery,
} from "./remark-image-gallery";

function image(alt: string, url = `${alt}.png`) {
  return { type: "image", alt, url };
}

function imageParagraph(...alts: string[]) {
  return { type: "paragraph", children: alts.map((alt) => image(alt)) };
}

describe("imagesFromParagraph", () => {
  it("collects images and ignores breaks or whitespace", () => {
    expect(
      imagesFromParagraph({
        type: "paragraph",
        children: [
          image("empty"),
          { type: "break" },
          { type: "text", value: "\n" },
          image("hover"),
        ],
      })?.map((node) => node.url),
    ).toEqual(["empty.png", "hover.png"]);
  });

  it("rejects mixed prose", () => {
    expect(
      imagesFromParagraph({
        type: "paragraph",
        children: [{ type: "text", value: "See " }, image("empty")],
      }),
    ).toBeNull();
  });
});

describe("groupImageSiblings", () => {
  it("leaves a lone image as a paragraph", () => {
    const grouped = groupImageSiblings([imageParagraph("empty")]);
    expect(grouped).toEqual([
      { type: "paragraph", children: [image("empty")] },
    ]);
  });

  it("wraps consecutive image paragraphs in one gallery", () => {
    const grouped = groupImageSiblings([
      { type: "paragraph", children: [{ type: "text", value: "Captures:" }] },
      imageParagraph("empty"),
      imageParagraph("hover"),
      { type: "paragraph", children: [{ type: "text", value: "Done." }] },
    ]);
    expect(grouped[0]).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "Captures:" }],
    });
    expect(grouped[1]).toMatchObject({
      type: "gallery",
      data: {
        hName: "div",
        hProperties: {
          className: "issue-md-gallery",
          "data-capture-gallery": "",
        },
      },
      children: [image("empty"), image("hover")],
    });
    expect(grouped[2]).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "Done." }],
    });
  });
});

describe("remarkImageGallery", () => {
  it("groups image-only paragraphs under nested parents", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "blockquote",
          children: [imageParagraph("empty"), imageParagraph("hover")],
        },
      ],
    };
    remarkImageGallery()(tree);
    expect(tree.children[0]?.children?.[0]?.type).toBe("gallery");
    expect(tree.children[0]?.children?.[0]?.children).toHaveLength(2);
  });
});
