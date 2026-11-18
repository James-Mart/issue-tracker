// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CapabilityCatalog } from "@server/services/capability-catalog";
import { CapabilityCatalogPage } from "./capability-catalog-page";

const state = vi.hoisted(() => ({
  mobile: false,
  catalog: {
  sharedDefault: {
    id: "default",
    kind: "default",
    title: "Shared default",
    contract: {
      settingSources: [],
      inject: [
        { kind: "skill", path: "skills/issue-tracker/SKILL.md" },
        { kind: "rule", path: "agents/_issue-tracker-cli.md" },
      ],
      customTools: ["delegate", "agent_stack_start"],
      builtins: ["read", "shell"],
      mcp: ["playwright"],
    },
  },
  profiles: [
    {
      id: "read-only",
      kind: "profile",
      title: "Read-only profile",
      contract: {
        settingSources: [],
        inject: [{ kind: "rule", path: "agents/_issue-tracker-cli.md" }],
        customTools: ["issue_read", "git_read"],
        builtins: ["read", "grep"],
        mcp: [],
      },
    },
  ],
  roles: [
    {
      id: "issue-tracker-implementor-grok",
      kind: "role",
      title: "implementor-grok",
      roleId: "issue-tracker-implementor-grok",
      profileTitle: "Shared default",
      description: "Implements one Task.",
      contract: {
        settingSources: [],
        inject: [
          { kind: "skill", path: "skills/issue-tracker/SKILL.md" },
          { kind: "role", path: "agents/issue-tracker-implementor-grok.md" },
        ],
        customTools: ["delegate"],
        builtins: ["read"],
        mcp: ["playwright"],
      },
    },
  ],
} satisfies CapabilityCatalog,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => state.mobile,
}));

vi.mock("../api/queries", () => ({
  useCapabilityCatalogQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: state.catalog,
  }),
}));

let root: Root | undefined;

function mount(path: string): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agents" element={<CapabilityCatalogPage />} />
          <Route path="/agents/default" element={<CapabilityCatalogPage />} />
          <Route
            path="/agents/profiles/:profileId"
            element={<CapabilityCatalogPage />}
          />
          <Route path="/agents/roles/:roleId" element={<CapabilityCatalogPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  state.mobile = false;
});

function contract(container: HTMLElement): HTMLElement {
  const node = container.querySelector(
    '[data-testid="capability-catalog-contract"]',
  );
  if (!(node instanceof HTMLElement)) {
    throw new Error("missing resolved contract");
  }
  return node;
}

describe("CapabilityCatalogPage", () => {
  it("shows the list and the shared default contract together on desktop", () => {
    const container = mount("/agents");
    const selected = container.querySelector(
      '[data-testid="catalog-entry-default-default"]',
    );
    expect(selected?.getAttribute("aria-current")).toBe("true");
    expect(container.querySelector('[data-testid="capability-catalog-list"]')).not.toBeNull();
    const resolved = contract(container);
    expect(resolved.textContent).toContain("Shared default");
    expect(resolved.textContent).toContain("SKILL");
    expect(resolved.textContent).toContain("RULE");
    expect(resolved.textContent).toContain("agent_stack_start");
    expect(resolved.textContent).toContain("playwright");
    expect(resolved.textContent).toContain(
      "Host rules, project rules, and plugin skills do not load.",
    );
    expect(resolved.textContent).not.toMatch(/disallowed/i);
    expect(resolved.textContent).not.toMatch(/worktree/i);

    const roleRow = container.querySelector(
      '[data-testid="catalog-entry-role-issue-tracker-implementor-grok"]',
    );
    expect(roleRow?.textContent).toContain("implementor-grok");
    expect(roleRow?.textContent).not.toContain("issue-tracker-implementor-grok");
  });

  it("shows a role's full id, profile, and one role-body inject row", () => {
    const container = mount("/agents/roles/issue-tracker-implementor-grok");
    const resolved = contract(container);
    expect(resolved.textContent).toContain("issue-tracker-implementor-grok");
    expect(resolved.textContent).toContain("Shared default");
    expect(resolved.textContent).toContain("ROLE BODY");
    expect(resolved.textContent?.match(/ROLE BODY/g)).toHaveLength(1);
    expect(resolved.textContent).not.toMatch(/disallowed/i);
    expect(resolved.textContent).not.toMatch(/worktree/i);
    expect(
      container
        .querySelector(
          '[data-testid="catalog-entry-role-issue-tracker-implementor-grok"]',
        )
        ?.getAttribute("aria-current"),
    ).toBe("true");
  });

  it("opens a profile contract without a role body", () => {
    const container = mount("/agents/profiles/read-only");
    const resolved = contract(container);
    expect(resolved.textContent).toContain("Read-only profile");
    expect(resolved.textContent).toContain("issue_read");
    expect(resolved.textContent).not.toContain("ROLE BODY");
    expect(resolved.textContent).toContain("None");
  });

  it("uses the list, then the contract with a back button, on mobile", async () => {
    state.mobile = true;
    const container = mount("/agents");
    expect(container.querySelector('[data-testid="capability-catalog-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="capability-catalog-contract"]')).toBeNull();
    expect(container.querySelector('[data-testid="catalog-back"]')).toBeNull();

    const role = container.querySelector(
      '[data-testid="catalog-entry-role-issue-tracker-implementor-grok"]',
    );
    if (!role) throw new Error("missing role row");
    await click(role);

    expect(container.querySelector('[data-testid="capability-catalog-list"]')).toBeNull();
    expect(contract(container).textContent).toContain(
      "issue-tracker-implementor-grok",
    );
    const back = container.querySelector('[data-testid="catalog-back"]');
    if (!back) throw new Error("missing back button");
    expect(back.getAttribute("aria-label")).toBe("Back to catalog");
    await click(back);

    expect(container.querySelector('[data-testid="capability-catalog-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="capability-catalog-contract"]')).toBeNull();
  });
});
