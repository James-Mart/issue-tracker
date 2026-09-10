// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { FIELD_LABELS } from "@server/fields";
import {
  SETUP_COMMAND_CAPTION,
  SETUP_COMMAND_EMPTY_LABEL,
} from "./issue-setup-command-field";
import { ProjectSettingsOverview } from "./project-settings-overview";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("./issue-workspace-field", () => ({
  IssueWorkspaceField: () => <div data-testid="workspace-field">Workspace</div>,
}));

vi.mock("./issue-merge-policy-field", () => ({
  IssueMergePolicyField: () => (
    <div data-testid="merge-policy-field">Merge policy</div>
  ),
}));

vi.mock("./issue-description-field", () => ({
  IssueDescriptionField: () => null,
}));

vi.mock("./issue-supporting-docs-field", () => ({
  IssueSupportingDocsField: () => null,
}));

vi.mock("./issue-project-labels-field", () => ({
  IssueProjectLabelsField: () => null,
}));

vi.mock("./attachments-panel", () => ({
  IssueAttachmentsSection: () => null,
}));

vi.mock("./issue-personas-field", () => ({
  IssuePersonasField: () => null,
}));

vi.mock("./issue-inspiration-apps-field", () => ({
  IssueInspirationAppsField: () => null,
}));

const t0 = "2026-08-01T00:00:00.000Z";

function project(
  overrides: Partial<Extract<IssueDetail, { kind: "project" }>> = {},
): Extract<IssueDetail, { kind: "project" }> {
  return {
    id: "platform",
    kind: "project",
    title: "Platform",
    workspace: "/tmp/repo",
    trunk: "main",
    mergePolicy: "pull-request",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
    ...overrides,
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

afterEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
});

describe("ProjectSettingsOverview Delivery card", () => {
  it("shows setup-command direction copy when unset", () => {
    const { container } = mount(
      <ProjectSettingsOverview issue={project({ setupCommand: undefined })} />,
    );

    expect(container.textContent).toContain(FIELD_LABELS.setupCommand);
    expect(container.textContent).toContain(SETUP_COMMAND_EMPTY_LABEL);
    expect(container.textContent).toContain(SETUP_COMMAND_CAPTION);
    expect(container.textContent).not.toContain("Worktree root");
  });

  it("shows a stored setup command in mono with the caption", () => {
    const { container } = mount(
      <ProjectSettingsOverview
        issue={project({ setupCommand: "npm install" })}
      />,
    );

    expect(container.textContent).toContain("npm install");
    expect(container.textContent).toContain(SETUP_COMMAND_CAPTION);
    expect(container.textContent).not.toContain(SETUP_COMMAND_EMPTY_LABEL);

    const commandButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("npm install"),
    );
    expect(commandButton?.className).toContain("font-mono");
  });

  it("does not render a worktree-root control in the Delivery card", () => {
    const { container } = mount(
      <ProjectSettingsOverview issue={project()} />,
    );

    expect(container.textContent).not.toMatch(/worktree root/i);
    expect(
      container.querySelector('[data-testid="worktree-root-field"]'),
    ).toBeNull();
  });
});
