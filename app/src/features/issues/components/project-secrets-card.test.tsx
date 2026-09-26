// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { ProjectSecretsCard } from "./project-secrets-card";

const setSecret = vi.fn();
const deleteSecret = vi.fn();
let secretKeys: string[] = [];
let secretsError = false;

vi.mock("../api/mutations", () => ({
  useSetProjectSecret: () => ({
    mutateAsync: setSecret,
    isPending: false,
  }),
  useDeleteProjectSecret: () => ({
    mutateAsync: deleteSecret,
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectSecretKeys: () => ({
    data: secretsError ? undefined : { keys: secretKeys },
    isSuccess: !secretsError,
    isError: secretsError,
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
  deleteSecret.mockReset();
  secretKeys = [];
  secretsError = false;
});

describe("ProjectSecretsCard", () => {
  it("lists key names and an empty state without values", () => {
    secretKeys = ["STRIPE_SANDBOX_KEY"];
    const { root } = mount(<ProjectSecretsCard issue={project()} />);
    expect(document.body.textContent).toContain("STRIPE_SANDBOX_KEY");
    expect(document.body.textContent).toContain("Add secret");
    expect(document.body.textContent).not.toContain(VALUE);
    root.unmount();

    secretKeys = [];
    mount(<ProjectSecretsCard issue={project()} />);
    expect(document.body.textContent).toContain("No secrets yet.");
  });

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

  it("replaces a secret from a password field and discards the value", async () => {
    secretKeys = ["STRIPE_SANDBOX_KEY", "OTHER_KEY"];
    setSecret.mockResolvedValue({
      keys: ["OTHER_KEY", "STRIPE_SANDBOX_KEY"],
    });
    mount(<ProjectSecretsCard issue={project()} />);

    await act(async () => {
      (
        document.querySelector(
          '[data-testid="secret-replace-STRIPE_SANDBOX_KEY"]',
        ) as HTMLButtonElement
      ).click();
    });

    const value = document.querySelector(
      '[data-testid="secret-value"]',
    ) as HTMLInputElement;
    expect(value.type).toBe("password");
    expect(value.placeholder).toBe("Enter replacement");

    await act(async () => {
      setInput(value, VALUE);
    });
    await act(async () => {
      buttonNamed(document.body, "Save replacement").click();
    });

    expect(setSecret).toHaveBeenCalledWith({
      key: "STRIPE_SANDBOX_KEY",
      value: VALUE,
    });
    expect(document.querySelector('[data-testid="secret-value"]')).toBeNull();
    expect(clientResidue()).not.toContain(VALUE);
    expect(document.body.textContent).toContain("OTHER_KEY");
  });

  it("removes a secret only after confirmation", async () => {
    secretKeys = ["STRIPE_SANDBOX_KEY"];
    deleteSecret.mockResolvedValue({ keys: [] });
    mount(<ProjectSecretsCard issue={project()} />);

    await act(async () => {
      (
        document.querySelector(
          '[data-testid="secret-remove-STRIPE_SANDBOX_KEY"]',
        ) as HTMLButtonElement
      ).click();
    });

    const dialog = document.body.querySelector(
      '[data-testid="secret-remove-dialog"]',
    );
    expect(dialog?.textContent).toContain("Remove secret?");
    expect(dialog?.textContent).toContain("STRIPE_SANDBOX_KEY");
    expect(dialog?.textContent).not.toContain(VALUE);

    await act(async () => {
      buttonNamed(dialog!, "Cancel").click();
    });
    expect(deleteSecret).not.toHaveBeenCalled();

    await act(async () => {
      (
        document.querySelector(
          '[data-testid="secret-remove-STRIPE_SANDBOX_KEY"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        document.body.querySelector(
          '[data-testid="secret-remove-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(deleteSecret).toHaveBeenCalledWith("STRIPE_SANDBOX_KEY");
    expect(
      document.body.querySelector('[data-testid="secret-remove-dialog"]'),
    ).toBeNull();
  });

  it("keeps an invalid add in the form and does not send it", async () => {
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
    await act(async () => {
      setInput(key, "not-a-key");
      setInput(value, VALUE);
      buttonNamed(document.body, "Save secret").click();
    });
    expect(setSecret).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("invalid secret key");
    expect(clientResidue()).not.toContain("not-a-key" + VALUE);
    expect(
      (document.querySelector('[data-testid="secret-value"]') as HTMLInputElement)
        .value,
    ).toBe(VALUE);
  });
});
