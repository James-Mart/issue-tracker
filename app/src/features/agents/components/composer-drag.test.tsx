// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"
import { COMPOSER_HEIGHT_ARROW_STEP_PX } from "../lib/composer-height"

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

function grip(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector(
    '[data-testid="composer-resize-grip"]',
  )
  expect(el).toBeTruthy()
  return el as HTMLButtonElement
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

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientY: number,
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientY,
      }),
    )
  })
}

function stubViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  })
  window.matchMedia = vi.fn((query: string) => {
    const matches =
      query === "(max-width: 859px)" ? width < 860 : false
    return {
      media: query,
      matches,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } satisfies MediaQueryList
  })
}

describe("Composer drag handle", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let pane: HTMLDivElement | undefined
  const paneHeight = { value: 500 }
  const scrollHeights: Record<string, number> = {}
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "scrollHeight",
  )

  function mountInPane() {
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
          conversationId="conv-1"
          model="composer-2.5-fast"
          runActive={false}
        />,
      )
    })
  }

  beforeEach(() => {
    paneHeight.value = 500
    for (const key of Object.keys(scrollHeights)) delete scrollHeights[key]
    stubViewport(1024)
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeights[(this as HTMLTextAreaElement).value] ?? 44
      },
    })
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
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
  })

  it("grows by the dragged delta and then ignores content sizing", () => {
    scrollHeights[""] = 44
    scrollHeights["taller draft"] = 120
    mountInPane()

    const input = textarea(container!)
    expect(input.style.height).toBe("44px")

    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", 340)
    dispatchPointer(handle, "pointerup", 340)

    expect(input.style.height).toBe("104px")

    setDraft(input, "taller draft")
    expect(input.style.height).toBe("104px")
  })

  it("clamps a drag past the top of the range at 80% of the pane", () => {
    scrollHeights[""] = 44
    mountInPane()

    const input = textarea(container!)
    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", -200)
    dispatchPointer(handle, "pointerup", -200)

    expect(input.style.height).toBe("400px")
  })

  it("adjusts the explicit height with arrow keys", () => {
    scrollHeights[""] = 44
    mountInPane()

    const input = textarea(container!)
    const handle = grip(container!)
    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(input.style.height).toBe(`${44 + COMPOSER_HEIGHT_ARROW_STEP_PX}px`)

    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(input.style.height).toBe("44px")
  })

  it("does not render the grip at phone width", () => {
    stubViewport(375)
    mountInPane()

    expect(
      container!.querySelector('[data-testid="composer-resize-grip"]'),
    ).toBeNull()
    expect(
      container!.querySelector('[aria-label="Resize composer"]'),
    ).toBeNull()
  })
})
