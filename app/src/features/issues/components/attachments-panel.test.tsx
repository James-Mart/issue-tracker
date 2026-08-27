// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import { AttachmentsPanel } from "./attachments-panel";

const queryState = vi.hoisted(() => ({
  data: undefined as Attachment[] | undefined,
  isLoading: false,
  error: null as Error | null,
}));

const deleteState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  variables: undefined as string | undefined,
}));

vi.mock("../api/queries", () => ({
  useAttachmentsQuery: () => ({
    data: queryState.data,
    isLoading: queryState.isLoading,
    error: queryState.error,
  }),
}));

vi.mock("../api/mutations", () => ({
  useDeleteAttachment: () => deleteState,
}));

const t0 = "2026-08-01T00:00:00.000Z";

function task(): IssueDetail {
  return {
    id: "task-1",
    kind: "task",
    title: "Task",
    partOf: "some-story",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "",
    labels: [],
    version: "v1",
    status: "todo",
  };
}

function attachment(overrides: Partial<Attachment> & { name: string }): Attachment {
  return {
    size: 1024,
    mtime: t0,
    mime: "application/octet-stream",
    ...overrides,
  };
}

function idleUpload(
  overrides: Partial<UploadAttachmentMutation> = {},
): UploadAttachmentMutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as UploadAttachmentMutation;
}

function heading(container: ParentNode, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("p")).find(
    (el) => el.textContent === text,
  );
}

function mountPanel(
  upload: UploadAttachmentMutation = idleUpload(),
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AttachmentsPanel issue={task()} upload={upload} />);
  });
  return { container, root };
}

describe("AttachmentsPanel", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    queryState.data = undefined;
    queryState.isLoading = false;
    queryState.error = null;
    deleteState.mutate.mockReset();
    deleteState.isPending = false;
    deleteState.variables = undefined;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("keeps the empty copy and header Upload control", () => {
    queryState.data = [];
    const mounted = mountPanel();
    container = mounted.container;
    root = mounted.root;
    expect(container.textContent).toContain(
      "No attachments yet. Use Upload to add a file.",
    );
    expect(heading(container, "Images")).toBeUndefined();
    expect(heading(container, "Other files")).toBeUndefined();
    expect(container.querySelector("button")?.textContent).toContain("Upload");
  });

  it("keeps the loading copy", () => {
    queryState.isLoading = true;
    const mounted = mountPanel();
    container = mounted.container;
    root = mounted.root;
    expect(container.textContent).toContain("Loading attachments…");
    expect(heading(container, "Images")).toBeUndefined();
    expect(heading(container, "Other files")).toBeUndefined();
    expect(container.querySelector("button")?.textContent).toContain("Upload");
  });

  it("puts image MIME rows in the filmstrip and the rest under Other files", () => {
    queryState.data = [
      attachment({ name: "shot.png", mime: "image/png", size: 240 * 1024 }),
      attachment({ name: "notes.pdf", mime: "application/pdf", size: 1024 * 1024 }),
      attachment({ name: "logo.svg", mime: "image/svg+xml", size: 12 * 1024 }),
      attachment({ name: "deploy-log.txt", mime: "text/plain", size: 4096 }),
    ];
    const mounted = mountPanel();
    container = mounted.container;
    root = mounted.root;

    const imagesHeading = heading(container, "Images");
    const othersHeading = heading(container, "Other files");
    expect(imagesHeading).toBeTruthy();
    expect(othersHeading).toBeTruthy();

    const filmstrip = imagesHeading!.nextElementSibling as HTMLElement;
    expect(filmstrip.textContent).toContain("shot.png");
    expect(filmstrip.textContent).toContain("logo.svg");
    expect(filmstrip.textContent).not.toContain("notes.pdf");
    expect(filmstrip.textContent).not.toContain("deploy-log.txt");

    const thumbs = filmstrip.querySelectorAll("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].getAttribute("src")).toBe(
      "/api/issues/task-1/attachments/shot.png",
    );
    expect(thumbs[1].getAttribute("src")).toBe(
      "/api/issues/task-1/attachments/logo.svg",
    );

    const otherList = othersHeading!.nextElementSibling as HTMLElement;
    expect(otherList.textContent).toContain("notes.pdf");
    expect(otherList.textContent).toContain("deploy-log.txt");
    expect(otherList.textContent).not.toContain("shot.png");
    expect(otherList.querySelector("img")).toBeNull();

    expect(
      container.querySelector('a[download="shot.png"]')?.getAttribute("href"),
    ).toBe("/api/issues/task-1/attachments/shot.png");
    expect(
      container.querySelector('a[download="notes.pdf"]')?.getAttribute("href"),
    ).toBe("/api/issues/task-1/attachments/notes.pdf");
  });

  it("omits Other files when every row is an image", () => {
    queryState.data = [
      attachment({ name: "shot.png", mime: "image/png" }),
    ];
    const mounted = mountPanel();
    container = mounted.container;
    root = mounted.root;
    expect(heading(container, "Images")).toBeTruthy();
    expect(heading(container, "Other files")).toBeUndefined();
  });

  it("omits Images when every row is a non-image", () => {
    queryState.data = [
      attachment({ name: "notes.pdf", mime: "application/pdf" }),
    ];
    const mounted = mountPanel();
    container = mounted.container;
    root = mounted.root;
    expect(heading(container, "Images")).toBeUndefined();
    expect(heading(container, "Other files")).toBeTruthy();
  });
});
