// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"
import { composerDraftStorageKey } from "../lib/composer-draft-storage"

const sendMutate = vi.fn()

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
    mutate: sendMutate,
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
    mutateAsync: vi.fn(),
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

function mountComposer(
  overrides: {
    conversationId?: string
    runActive?: boolean
  } = {},
): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <Composer
        conversationId={overrides.conversationId ?? "conv-1"}
        model="composer-2.5-fast"
        runActive={overrides.runActive ?? false}
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

function pressEnter(input: HTMLTextAreaElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    input.dispatchEvent(event)
  })
  return event
}

describe("Composer during active run", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
  })

  it("queues on Enter during an active run", () => {
    ;({ container, root } = mountComposer({ runActive: true }))

    const input = textarea(container!)
    setDraft(input, "mid-run steer")
    pressEnter(input)

    expect(sendMutate).toHaveBeenCalledTimes(1)
    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: { prompt: "mid-run steer", model: "composer-2.5-fast" },
      },
      expect.any(Object),
    )
  })
})

describe("Composer draft persistence", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    localStorage.clear()
    vi.useRealTimers()
  })

  it("does not leak drafts across conversation ids", () => {
    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    setDraft(textarea(container!), "Draft for A")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    act(() => root!.unmount())
    container!.remove()
    container = undefined
    root = undefined

    ;({ container, root } = mountComposer({ conversationId: "conv-b" }))

    expect(textarea(container!).value).toBe("")

    setDraft(textarea(container!), "Draft for B")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    act(() => root!.unmount())
    container!.remove()
    container = undefined
    root = undefined

    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    expect(textarea(container!).value).toBe("Draft for A")
    expect(localStorage.getItem(composerDraftStorageKey("conv-b"))).toBe(
      "Draft for B",
    )
  })
})

