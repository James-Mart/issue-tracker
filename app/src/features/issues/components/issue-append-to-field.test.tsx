// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import {
  APPEND_TARGET_EMPTY_LABEL,
  APPEND_TARGET_MERGED,
  APPEND_TARGET_NOT_FOUND,
  appendTargetWrongKindReason,
} from "../lib/append-target";
import { resetAppendTargetDraftStore } from "../store/use-append-target-draft-store";
import { IssueAppendToField } from "./issue-append-to-field";

const go = vi.fn();
const mutateAsync = vi.fn();

const t0 = "2026-08-10T12:00:00.000Z";

const project: IssueRecord = {
  kind: "project",
  id: "platform",
  title: "Platform",
  mergePolicy: "manual",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
};

const epic: IssueRecord = {
  kind: "epic",
  id: "auth-epic",
  title: "Auth",
  partOf: "platform",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
};

const openStory: IssueRecord = {
  kind: "story",
  id: "open-story",
  title: "OAuth callback hardening",
  partOf: "auth-epic",
  order: 0,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
  merged: false,
};

const mergedStory: IssueRecord = {
  kind: "story",
  id: "merged-story",
  title: "Session cookie rotation",
  partOf: "auth-epic",
  order: 1,
  archived: false,
  needsAttention: false,
  createdAt: t0,
  updatedAt: t0,
  merged: true,
};

vi.mock("./issue-link", () => ({
  IssueLink: ({
    id,
    children,
  }: {
    id: string;
    children: React.ReactNode;
  }) => (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        go(id);
      }}
    >
      {children}
    </a>
  ),
  useIssueLinkNavigate: () => ({
    go,
    hrefFor: (id: string) => `#${id}`,
  }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync }),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: [project, epic, openStory, mergedStory],
    },
  }),
}));

function idea(
  appendTo?: string,
): Extract<IssueDetail, { kind: "idea" }> {
  return {
    kind: "idea",
    id: "capture",
    title: "Capture",
    partOf: "platform",
    order: 0,
    archived: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
    appendTo,
  };
}

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

function editButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[aria-label="Edit append target"]',
  ) as HTMLButtonElement;
}

function clearButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[aria-label="Clear append target"]',
  ) as HTMLButtonElement;
}

async function beginEdit(container: HTMLElement): Promise<void> {
  await act(async () => {
    editButton(container).click();
  });
}

async function commitDraft(
  container: HTMLElement,
  value: string,
): Promise<void> {
  const input = container.querySelector("input") as HTMLInputElement;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  go.mockReset();
  mutateAsync.mockReset();
  resetAppendTargetDraftStore();
});

describe("IssueAppendToField", () => {
  it("states that an unset target means a new root Story", () => {
    const { container } = mount(<IssueAppendToField issue={idea()} />);

    expect(container.textContent).toContain(APPEND_TARGET_EMPTY_LABEL);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it.each([
    ["phone", "390px"],
    ["desktop", "1440px"],
  ] as const)(
    "shows the edit affordance on %s without hover",
    (_viewport, width) => {
      const { container } = mount(
        <div style={{ width }}>
          <IssueAppendToField issue={idea()} />
        </div>,
      );
      const pencil = editButton(container);

      expect(pencil).toBeTruthy();
      expect(pencil.className).not.toMatch(
        /opacity-0|invisible|hidden|sr-only|group-hover/,
      );
      expect(getComputedStyle(pencil).opacity).not.toBe("0");
    },
  );

  it("shows the Story title as a navigating link with a navigate arrow", async () => {
    const { container } = mount(
      <IssueAppendToField issue={idea("open-story")} />,
    );
    const link = container.querySelector("a") as HTMLAnchorElement;

    expect(link.textContent).toBe("OAuth callback hardening");
    expect(container.textContent).not.toContain("open-story");
    expect(container.querySelector('[title="Open open-story"]')).toBeTruthy();
    expect(editButton(container)).toBeTruthy();

    await act(async () => {
      link.click();
    });

    expect(go).toHaveBeenCalledWith("open-story");
    expect(container.querySelector("input")).toBeNull();
  });

  it.each([
    ["ghost", APPEND_TARGET_NOT_FOUND],
    ["auth-epic", appendTargetWrongKindReason("epic")],
    ["merged-story", APPEND_TARGET_MERGED],
  ] as const)(
    "keeps a rejected %s paste visible with its own reason",
    async (draft, reason) => {
      const { container } = mount(<IssueAppendToField issue={idea()} />);
      await beginEdit(container);
      await commitDraft(container, draft);

      const input = container.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe(draft);
      expect(container.textContent).toContain(reason);
      expect(clearButton(container)).toBeTruthy();
      expect(mutateAsync).not.toHaveBeenCalled();
    },
  );

  it("clears a rejected paste back to the empty state", async () => {
    const { container } = mount(<IssueAppendToField issue={idea()} />);
    await beginEdit(container);
    await commitDraft(container, "ghost");
    expect(container.textContent).toContain(APPEND_TARGET_NOT_FOUND);

    await act(async () => {
      clearButton(container).click();
    });

    expect(container.textContent).toContain(APPEND_TARGET_EMPTY_LABEL);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain(APPEND_TARGET_NOT_FOUND);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("saves a valid Story id and clears a set target", async () => {
    mutateAsync.mockResolvedValue({});
    const { container, root } = mount(<IssueAppendToField issue={idea()} />);
    await beginEdit(container);
    await commitDraft(container, "open-story");

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { appendTo: "open-story" },
    });

    await act(async () => {
      root.render(<IssueAppendToField issue={idea("open-story")} />);
    });
    await act(async () => {
      clearButton(container).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { appendTo: null },
    });
  });
});
