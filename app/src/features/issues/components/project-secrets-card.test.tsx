// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { ProjectSecretsCard } from "./project-secrets-card";

const setSecret = vi.fn();

vi.mock("../api/mutations", () => ({
  useSetProjectSecret: () => ({
    mutateAsync: setSecret,
    isPending: false,
  }),
  useDeleteProjectSecret: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectSecretKeys: () => ({
    data: { keys: [] },
    isSuccess: true,
    isError: false,
  }),
}));

const VALUE = "sk_test_discard_me_991";
const t0 = "2026-08-01T00:00:00.000Z";

function project(): Extract<IssueDetail, { kind: "project" }> {
  return {
    id: "platform",
    kind: "project",
    title: "Platform",
    workspace: "/tmp/repo",
    trunk: "main",
    mergePolicy: "pull-request",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
  };
}

function mount(ui: React.ReactElement): { root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { root };
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing button ${name}`);
  }
  return button;
}

function setInput(input: HTMLInputElement, value: string): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Visible text plus every control value, so a password is not invisible. */
function clientResidue(): string {
  const values = [...document.querySelectorAll("input, textarea")].map(
    (node) => (node as HTMLInputElement).value,
  );
  return `${document.body.textContent ?? ""}\n${values.join("\n")}`;
}

afterEach(() => {
  document.body.innerHTML = "";
  setSecret.mockReset();
});

describe("ProjectSecretsCard", () => {
  it("adds a secret from a password field and discards the value", async () => {
    setSecret.mockResolvedValue({ keys: ["NEW_KEY"] });
    mount(<ProjectSecretsCard issue={project()} />);

    await act(async () => {
      buttonNamed(document.body, "Add secret").click();
    });

    const key = document.querySelector(
      '[data-testid="secret-key"]',
    ) as HTMLInputElement;
    const value = document.querySelector(
      '[data-testid="secret-value"]',
    ) as HTMLInputElement;
    expect(value.type).toBe("password");

    await act(async () => {
      setInput(key, "NEW_KEY");
      setInput(value, VALUE);
    });
    await act(async () => {
      buttonNamed(document.body, "Save secret").click();
    });

    expect(setSecret).toHaveBeenCalledWith({ key: "NEW_KEY", value: VALUE });
    expect(document.querySelector('[data-testid="secret-value"]')).toBeNull();
    expect(clientResidue()).not.toContain(VALUE);
  });
});
