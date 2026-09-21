// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"
import { composerDraftStorageKey } from "../lib/composer-draft-storage"

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

describe("Composer auto-grow", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let pane: HTMLDivElement | undefined
  const paneHeight = { value: 500 }
  const scrollHeights: Record<string, number> = {}
  const observers: ResizeObserverCallback[] = []
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "scrollHeight",
  )

  function mountInPane(conversationId?: string) {
    pane = document.createElement("div")
    pane.setAttribute("data-thread-pane", "")
    Object.defineProperty(pane, "clientHeight", {
      configurable: true,
      get: () => paneHeight.value,
    })
    document.body.appendChild(pane)
    container = document.createElement("div")
    pane.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <Composer
          conversationId={conversationId ?? "conv-1"}
          model="composer-2.5-fast"
          runActive={false}
        />,
      )
    })
  }

  beforeEach(() => {
    paneHeight.value = 500
    for (const key of Object.keys(scrollHeights)) delete scrollHeights[key]
    observers.length = 0
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeights[(this as HTMLTextAreaElement).value] ?? 44
      },
    })
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: ResizeObserverCallback
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    )
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    pane?.remove()
    container = undefined
    root = undefined
    pane = undefined
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      )
    }
    vi.unstubAllGlobals()
    localStorage.clear()
    vi.useRealTimers()
  })

  it("grows with content and stops at 40% of the observed pane height", () => {
    scrollHeights[""] = 44
    scrollHeights["short"] = 80
    scrollHeights["long\n".repeat(20)] = 280
    mountInPane()

    const input = textarea(container!)
    expect(input.style.height).toBe("44px")
    expect(input.className).toMatch(/\boverflow-y-auto\b/)
    expect(input.className).not.toMatch(/\bmax-h-40\b/)

    setDraft(input, "short")
    expect(input.style.height).toBe("80px")

    setDraft(input, "long\n".repeat(20))
    expect(input.style.height).toBe("200px")
  })

  it("sizes a persisted draft on mount from its scroll height", () => {
    localStorage.setItem(composerDraftStorageKey("conv-a"), "restored draft")
    scrollHeights["restored draft"] = 120
    mountInPane("conv-a")

    expect(textarea(container!).style.height).toBe("120px")
  })

  it("recomputes the ceiling when the thread pane resizes", () => {
    scrollHeights[""] = 44
    scrollHeights["overflowing draft"] = 280
    mountInPane()

    const input = textarea(container!)
    setDraft(input, "overflowing draft")
    expect(input.style.height).toBe("200px")

    paneHeight.value = 800
    act(() => {
      for (const cb of observers) cb([], {} as ResizeObserver)
    })
    expect(input.style.height).toBe("280px")
  })
})
