// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { COMPOSER_25_MODEL_ID } from "@/features/issues/lib/planning-launch"
import { NEW_CONVERSATION_DEFAULT_PROJECT_ID } from "../lib/create-conversation-defaults"
import { useAgentsUiStore } from "../store/use-agents-ui-store"
import { CreateConversationDialog } from "./create-conversation-dialog"

const { catalog, mutate } = vi.hoisted(() => ({
  catalog: {
    issuesLoading: false,
    modelsLoading: false,
    issues: [] as Array<Record<string, unknown>>,
    models: [] as Array<{ id: string; displayName: string }>,
  },
  mutate: vi.fn(),
}))

vi.mock("../api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: catalog.models },
    isLoading: catalog.modelsLoading,
  }),
}))

vi.mock("../api/mutations", () => ({
  useCreateConversation: () => ({
    mutate,
    isPending: false,
  }),
}))

vi.mock("@/features/issues/api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: catalog.issues },
    isLoading: catalog.issuesLoading,
  }),
}))

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
}))

function project(id: string, workspace?: string) {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    ...(workspace !== undefined ? { workspace } : {}),
  }
}

function composerModel() {
  return { id: COMPOSER_25_MODEL_ID, displayName: "Composer 2.5" }
}

function readyDefaults() {
  catalog.issuesLoading = false
  catalog.modelsLoading = false
  catalog.issues = [project(NEW_CONVERSATION_DEFAULT_PROJECT_ID, "/ws")]
  catalog.models = [composerModel()]
}

function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<CreateConversationDialog />)
  })
  return { container, root }
}

function openDialog() {
  act(() => {
    useAgentsUiStore.getState().openCreateDialog()
  })
}

describe("CreateConversationDialog focus", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    readyDefaults()
    mutate.mockReset()
    useAgentsUiStore.setState({ createDialogOpen: false })
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    document.body.innerHTML = ""
    useAgentsUiStore.setState({ createDialogOpen: false })
  })

  it("focuses the title once both catalogs are known and both defaults are set", () => {
    catalog.issuesLoading = true
    catalog.modelsLoading = true
    ;({ container, root } = mount())
    openDialog()

    expect(document.activeElement?.id).not.toBe("conversation-title")

    catalog.issuesLoading = false
    catalog.modelsLoading = false
    act(() => {
      root!.render(<CreateConversationDialog />)
    })

    expect(document.activeElement?.id).toBe("conversation-title")
  })
})
