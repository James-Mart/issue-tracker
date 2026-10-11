import { describe, expect, it } from "vitest";
import { attachmentLinkHref } from "./attachments";

describe("attachmentLinkHref", () => {
  it("rejects unsafe relative paths", () => {
    expect(attachmentLinkHref("../x", "c1")).toBeNull();
    expect(attachmentLinkHref("foo/bar", "c1")).toBeNull();
    expect(attachmentLinkHref("attachments/foo", "c1")).toBeNull();
    expect(attachmentLinkHref("..", "c1")).toBeNull();
    expect(attachmentLinkHref("./", "c1")).toBeNull();
  });
});
