// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"

const uploadMutateAsync = vi.fn()

vi.mock("../hooks/use-voice-recording", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../hooks/use-voice-recording")>()
  return {
    ...original,
    useVoiceRecording: () => ({
      state: "idle" as const,
      elapsedSeconds: 0,
      errorKind: null,
      errorReason: null,
      start: vi.fn(),
      cancel: vi.fn(),
      confirm: vi.fn(),
      retry: vi.fn(),
    }),
  }
})

vi.mock("../api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useInterruptConversationRun: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCancelConversationRun: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateConversation: () => ({
    mutate: vi.fn(),
  }),
  useUploadConversationAttachment: () => ({
    mutateAsync: uploadMutateAsync,
    isPending: false,
  }),
  useDeleteConversationAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock("../api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: {
      models: [{ id: "composer-2.5-fast", displayName: "Composer" }],
    },
    isLoading: false,
  }),
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
  }),
}))

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}))

function mountComposer(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <Composer
        conversationId="conv-1"
        model="composer-2.5-fast"
        runActive={false}
      />,
    )
  })
  return { container, root }
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea")
  expect(el).toBeTruthy()
  return el as HTMLTextAreaElement
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!
  act(() => {
    nativeInputValueSetter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function fileInput(container: ParentNode): HTMLInputElement {
  const el = container.querySelector('input[type="file"]')
  expect(el).toBeTruthy()
  return el as HTMLInputElement
}

function pickFile(input: HTMLInputElement, file: File) {
  act(() => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    })
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("Composer attachments", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    uploadMutateAsync.mockReset()
  })

  it("shows an upload error banner without clearing the draft or staged chips", async () => {
    uploadMutateAsync
      .mockResolvedValueOnce({
        name: "palette.png",
        size: 100,
        mimeType: "image/png",
      })
      .mockRejectedValueOnce(new Error("attachment too large"))
    ;({ container, root } = mountComposer())

    setDraft(textarea(container!), "Keep this draft")

    pickFile(
      fileInput(container!),
      new File(["pixels"], "palette.png", { type: "image/png" }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    pickFile(
      fileInput(container!),
      new File(["big"], "huge.mov", { type: "video/quicktime" }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    const banner = container!.querySelector(
      '[data-testid="upload-error"]',
    ) as HTMLElement
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain(
      "Attachments must be 25 MB or smaller.",
    )
    expect(banner.innerHTML).not.toMatch(/\btruncate\b/)
    expect(textarea(container!).value).toBe("Keep this draft")
    expect(
      container!.querySelector('[data-testid="staged-attachment-palette.png"]'),
    ).toBeTruthy()
  })
})
