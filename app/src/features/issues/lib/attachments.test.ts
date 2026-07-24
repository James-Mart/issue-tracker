import { describe, expect, it } from "vitest";
import {
  attachmentDownloadName,
  attachmentLinkHref,
  attachmentsApiPath,
  formatAttachmentSize,
  isSafeAttachmentName,
  supportsAttachments,
} from "./attachments";

describe("supportsAttachments", () => {
  it("shows the panel for kinds with the attachments capability", () => {
    expect(supportsAttachments("project")).toBe(true);
    expect(supportsAttachments("epic")).toBe(true);
    expect(supportsAttachments("story")).toBe(true);
    expect(supportsAttachments("task")).toBe(true);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(10 * 1024)).toBe("10 KB");
    expect(formatAttachmentSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("attachmentsApiPath", () => {
  it("builds collection and item paths with consistent encoding", () => {
    expect(attachmentsApiPath("c1")).toBe("/api/issues/c1/attachments");
    expect(attachmentsApiPath("c1", "mock.tsx")).toBe(
      "/api/issues/c1/attachments/mock.tsx",
    );
    expect(attachmentsApiPath("c1", "a b.png")).toBe(
      "/api/issues/c1/attachments/a%20b.png",
    );
  });
});

describe("isSafeAttachmentName", () => {
  it("accepts plain basenames and rejects path segments", () => {
    expect(isSafeAttachmentName("foo.tsx")).toBe(true);
    expect(isSafeAttachmentName("a b.png")).toBe(true);
    expect(isSafeAttachmentName("")).toBe(false);
    expect(isSafeAttachmentName(".")).toBe(false);
    expect(isSafeAttachmentName("..")).toBe(false);
    expect(isSafeAttachmentName("../x")).toBe(false);
    expect(isSafeAttachmentName("foo/bar")).toBe(false);
    expect(isSafeAttachmentName("attachments/foo")).toBe(false);
    expect(isSafeAttachmentName("foo\\bar")).toBe(false);
  });
});

describe("attachmentLinkHref", () => {
  it("resolves safe relative basenames to the attachments API path", () => {
    expect(attachmentLinkHref("foo.tsx", "c1")).toBe(
      "/api/issues/c1/attachments/foo.tsx",
    );
    expect(attachmentLinkHref("./mock.tsx", "c1")).toBe(
      "/api/issues/c1/attachments/mock.tsx",
    );
  });

  it("strips fragment and query before resolving", () => {
    expect(attachmentLinkHref("foo.tsx#section", "c1")).toBe(
      "/api/issues/c1/attachments/foo.tsx",
    );
    expect(attachmentLinkHref("foo.tsx?v=1", "c1")).toBe(
      "/api/issues/c1/attachments/foo.tsx",
    );
    expect(attachmentLinkHref("./bar.png?x=1#y", "c1")).toBe(
      "/api/issues/c1/attachments/bar.png",
    );
  });

  it("rejects unsafe relative paths", () => {
    expect(attachmentLinkHref("../x", "c1")).toBeNull();
    expect(attachmentLinkHref("foo/bar", "c1")).toBeNull();
    expect(attachmentLinkHref("attachments/foo", "c1")).toBeNull();
    expect(attachmentLinkHref("..", "c1")).toBeNull();
    expect(attachmentLinkHref("./", "c1")).toBeNull();
  });

  it("leaves issue:, absolute, and http(s) hrefs alone", () => {
    expect(attachmentLinkHref("issue:other", "c1")).toBeNull();
    expect(attachmentLinkHref("https://example.com/x", "c1")).toBeNull();
    expect(attachmentLinkHref("http://example.com/x", "c1")).toBeNull();
    expect(attachmentLinkHref("/api/issues/c1/attachments/x", "c1")).toBeNull();
    expect(attachmentLinkHref("#section", "c1")).toBeNull();
    expect(attachmentLinkHref("//cdn.example/x", "c1")).toBeNull();
    expect(attachmentLinkHref("mailto:a@b.c", "c1")).toBeNull();
  });
});

describe("attachmentDownloadName", () => {
  it("extracts a safe basename from an attachments API href", () => {
    expect(
      attachmentDownloadName("/api/issues/c1/attachments/foo.tsx"),
    ).toBe("foo.tsx");
    expect(
      attachmentDownloadName("/api/issues/c1/attachments/a%20b.png"),
    ).toBe("a b.png");
    expect(attachmentDownloadName("https://example.com/x")).toBeNull();
    expect(attachmentDownloadName("/projects/p/issues/c1")).toBeNull();
  });
});
