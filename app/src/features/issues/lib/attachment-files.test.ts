import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_EDITOR_ATTR,
  dataTransferHasFiles,
  defaultPasteFileName,
  ensureAttachmentFileName,
  filesFromDataTransfer,
  isDescriptionEditorTarget,
} from "./attachment-files";

describe("defaultPasteFileName", () => {
  it("maps common image MIME types", () => {
    expect(defaultPasteFileName("image/png")).toBe("paste.png");
    expect(defaultPasteFileName("image/jpeg")).toBe("paste.jpg");
  });

  it("falls back to the subtype or bin", () => {
    expect(defaultPasteFileName("application/octet-stream")).toBe(
      "paste.octet-stream",
    );
    expect(defaultPasteFileName("")).toBe("paste.bin");
  });
});

describe("ensureAttachmentFileName", () => {
  it("keeps an existing name", () => {
    const file = new File(["x"], "shot.png", { type: "image/png" });
    expect(ensureAttachmentFileName(file)).toBe(file);
  });

  it("assigns paste.<ext> when name is empty", () => {
    const file = new File(["x"], "", { type: "image/png" });
    const named = ensureAttachmentFileName(file);
    expect(named.name).toBe("paste.png");
    expect(named.type).toBe("image/png");
  });
});

describe("filesFromDataTransfer", () => {
  it("reads FileList entries", () => {
    const file = new File(["a"], "a.txt", { type: "text/plain" });
    const dt = {
      files: [file] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    } as DataTransfer;
    expect(filesFromDataTransfer(dt)).toEqual([file]);
  });

  it("returns empty when null", () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
  });
});

describe("dataTransferHasFiles", () => {
  it("detects the Files type", () => {
    expect(
      dataTransferHasFiles({ types: ["Files"] } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      dataTransferHasFiles({ types: ["text/plain"] } as unknown as DataTransfer),
    ).toBe(false);
    expect(dataTransferHasFiles(null)).toBe(false);
  });
});

describe("isDescriptionEditorTarget", () => {
  it("is false for null and non-elements", () => {
    expect(isDescriptionEditorTarget(null)).toBe(false);
    expect(isDescriptionEditorTarget({} as EventTarget)).toBe(false);
  });

  it("matches a marked editor and its descendants via closest", () => {
    const editor = {
      closest(selector: string) {
        return selector === `[${DESCRIPTION_EDITOR_ATTR}]` ? editor : null;
      },
    };
    const child = {
      closest(selector: string) {
        return editor.closest(selector);
      },
    };
    const outside = {
      closest() {
        return null;
      },
    };
    expect(isDescriptionEditorTarget(editor as unknown as EventTarget)).toBe(
      true,
    );
    expect(isDescriptionEditorTarget(child as unknown as EventTarget)).toBe(
      true,
    );
    expect(isDescriptionEditorTarget(outside as unknown as EventTarget)).toBe(
      false,
    );
  });

  it("exports the description editor attribute name", () => {
    expect(DESCRIPTION_EDITOR_ATTR).toBe("data-issue-description-editor");
  });
});
