// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import {
  IssueSetupCommandField,
  SETUP_COMMAND_CAPTION,
  SETUP_COMMAND_EMPTY_LABEL,
} from "./issue-setup-command-field";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

const project: Extract<IssueDetail, { kind: "project" }> = {
  id: "platform",
  kind: "project",
  title: "Platform",
  trunk: "main",
  mergePolicy: "manual",
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  version: "v1",
};

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

describe("IssueSetupCommandField", () => {
  it("shows direction copy and caption when unset", () => {
    const { container } = mount(
      <IssueSetupCommandField issue={project} />,
    );

    expect(container.textContent).toContain(SETUP_COMMAND_EMPTY_LABEL);
    expect(container.textContent).toContain(SETUP_COMMAND_CAPTION);
  });
});
