// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { IssueDescriptionField } from "./issue-description-field";
import { descriptionDraftStorageKey } from "../lib/description-draft-storage";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

const t0 = "2026-08-01T00:00:00.000Z";

function task(
  overrides: Partial<IssueDetail> & { id: string; description?: string },
): IssueDetail {
  return {
    id: overrides.id,
    kind: "task",
    title: "Task",
    partOf: "some-story",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: overrides.description ?? "Saved description",
    labels: [],
    version: overrides.version ?? "v1",
    ...overrides,
  };
}

function mountDescriptionField(issue: IssueDetail): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<IssueDescriptionField issue={issue} />);
  });
  return { container, root };
}

function displayTrigger(container: ParentNode): HTMLElement {
  const el = container.querySelector("[tabindex='0']");
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  expect(el).toBeTruthy();
  return el as HTMLTextAreaElement;
}

function enterEdit(container: ParentNode) {
  act(() => {
    displayTrigger(container).click();
  });
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEscape(input: HTMLTextAreaElement) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function blurTextarea(input: HTMLTextAreaElement) {
  act(() => {
    input.blur();
  });
}

describe("IssueDescriptionField draft persistence", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mutateAsync.mockReset();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    localStorage.clear();
    vi.useRealTimers();
  });

  it("does not auto-open edit mode when a draft exists", () => {
    localStorage.setItem(
      descriptionDraftStorageKey("task-a"),
      "Stored draft",
    );
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    expect(container!.querySelector("textarea")).toBeNull();
  });

  it("restores the draft after remount when re-entering edit", () => {
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Long in-progress description");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBe(
      "Long in-progress description",
    );

    act(() => root!.unmount());
    container!.remove();
    container = undefined;
    root = undefined;

    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Long in-progress description");
  });

  it("does not leak drafts across issue ids", () => {
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved A" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Draft for A");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => root!.unmount());
    container!.remove();
    container = undefined;
    root = undefined;

    ;({ container, root } = mountDescriptionField(
      task({ id: "task-b", description: "Saved B" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Saved B");

    setDraft(textarea(container!), "Draft for B");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => root!.unmount());
    container!.remove();
    container = undefined;
    root = undefined;

    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved A" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Draft for A");
    expect(localStorage.getItem(descriptionDraftStorageKey("task-b"))).toBe(
      "Draft for B",
    );
  });

  it("prefers a differing stored draft over saved text", () => {
    localStorage.setItem(
      descriptionDraftStorageKey("task-a"),
      "Different draft",
    );
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Different draft");
  });

  it("drops a stored draft that equals saved text", () => {
    localStorage.setItem(
      descriptionDraftStorageKey("task-a"),
      "Saved description",
    );
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Saved description");
    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBeNull();
  });

  it("clears storage on successful save", async () => {
    mutateAsync.mockResolvedValue(undefined);
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Updated description");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBe(
      "Updated description",
    );

    blurTextarea(textarea(container!));
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "task-a",
      patch: { description: "Updated description" },
    });
    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBeNull();
  });

  it("clears storage when the draft field is emptied", () => {
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Will delete");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBe(
      "Will delete",
    );

    setDraft(textarea(container!), "");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBeNull();
  });

  it("clears storage on Escape cancel", () => {
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Canceled draft");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBe(
      "Canceled draft",
    );

    pressEscape(textarea(container!));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(localStorage.getItem(descriptionDraftStorageKey("task-a"))).toBeNull();
  });
});
