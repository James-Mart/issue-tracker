// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"
import { composerDraftStorageKey } from "../lib/composer-draft-storage"
import { COMPOSER_HEIGHT_STORAGE_KEY } from "../lib/composer-height-storage"

const sendMutate = vi.fn()
const interruptMutate = vi.fn()

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
    mutate: interruptMutate,
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

const coarsePointer = vi.hoisted(() => ({ value: false }))

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => coarsePointer.value,
}))

function mountComposer(
  overrides: {
    conversationId?: string
    model?: string
    runActive?: boolean
    disabled?: boolean
    disabledPlaceholder?: string
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
        model={overrides.model ?? "composer-2.5-fast"}
        runActive={overrides.runActive ?? false}
        disabled={overrides.disabled}
        disabledPlaceholder={overrides.disabledPlaceholder}
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

function sendButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('button[aria-label="Send"]')
  expect(el).toBeTruthy()
  return el as HTMLButtonElement
}

describe("Composer Enter key", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
    interruptMutate.mockClear()
    coarsePointer.value = false
  })

  it("sends on Enter without Shift when the pointer is fine", () => {
    coarsePointer.value = false
    ;({ container, root } = mountComposer())

    const input = textarea(container!)
    setDraft(input, "Hello")
    const event = pressEnter(input)

    expect(event.defaultPrevented).toBe(true)
    expect(sendMutate).toHaveBeenCalledTimes(1)
    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: { prompt: "Hello", model: "composer-2.5-fast" },
      },
      expect.any(Object),
    )
  })

  it("lets Enter insert a newline when the pointer is coarse", () => {
    coarsePointer.value = true
    ;({ container, root } = mountComposer())

    const input = textarea(container!)
    setDraft(input, "Line one")
    const event = pressEnter(input)

    expect(event.defaultPrevented).toBe(false)
    expect(sendMutate).not.toHaveBeenCalled()
    expect(input.title).toBe("Enter for a new line")
  })

  it("shows Enter-to-send hint when the pointer is fine", () => {
    coarsePointer.value = false
    ;({ container, root } = mountComposer())

    expect(textarea(container!).title).toBe(
      "Enter to send, Shift+Enter for a newline",
    )
  })
})

describe("Composer send affordance", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
    interruptMutate.mockClear()
    coarsePointer.value = false
  })

  it("enables Send with a draft under a coarse pointer", () => {
    coarsePointer.value = true
    ;({ container, root } = mountComposer())

    expect(sendButton(container!).disabled).toBe(true)

    setDraft(textarea(container!), "Line one\nLine two")

    expect(sendButton(container!).disabled).toBe(false)
  })

  it("submits via Send when the pointer is coarse", () => {
    coarsePointer.value = true
    ;({ container, root } = mountComposer())

    setDraft(textarea(container!), "Line one\nLine two")
    act(() => {
      sendButton(container!).click()
    })

    expect(sendMutate).toHaveBeenCalledTimes(1)
    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: { prompt: "Line one\nLine two", model: "composer-2.5-fast" },
      },
      expect.any(Object),
    )
  })

  it("keeps Send at a touch target size on narrow viewports", () => {
    coarsePointer.value = true
    ;({ container, root } = mountComposer())

    const button = sendButton(container!)
    expect(button.className).toMatch(/\bh-11\b/)
    expect(button.className).toMatch(/\bw-11\b/)
    expect(button.className).toMatch(/\bshell:h-9\b/)
    expect(button.className).toMatch(/\bshell:w-9\b/)
  })

  it("enables Send with a draft even when the model picker is empty", () => {
    coarsePointer.value = true
    ;({ container, root } = mountComposer({ model: "" }))

    setDraft(textarea(container!), "Hello")

    expect(sendButton(container!).disabled).toBe(false)
  })
})

describe("Composer during active run", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
    interruptMutate.mockClear()
    coarsePointer.value = false
  })

  function queueButton(container: ParentNode): HTMLButtonElement {
    const el = container.querySelector('button[aria-label="Queue message"]')
    expect(el).toBeTruthy()
    return el as HTMLButtonElement
  }

  it("shows Queue message alongside Stop and posts on send", () => {
    ;({ container, root } = mountComposer({ runActive: true }))

    setDraft(textarea(container!), "steer please")

    const queue = queueButton(container!)
    expect(queue.disabled).toBe(false)
    expect(queue.title).toContain("Queue message")
    expect(
      container!.querySelector('button[aria-label="Stop"]'),
    ).toBeTruthy()

    act(() => {
      queue.click()
    })

    expect(sendMutate).toHaveBeenCalledTimes(1)
    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: { prompt: "steer please", model: "composer-2.5-fast" },
      },
      expect.any(Object),
    )
  })

  it("queues on Enter during an active run", () => {
    coarsePointer.value = false
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

  it("shows Send now only with an active run and a non-empty draft", () => {
    ;({ container, root } = mountComposer({ runActive: true }))

    expect(
      container!.querySelector('button[aria-label="Send now"]'),
    ).toBeNull()

    setDraft(textarea(container!), "redirect please")

    expect(
      container!.querySelector('button[aria-label="Send now"]'),
    ).toBeTruthy()
  })

  it("renders Queue message, Send now, and Stop together during an active run with a draft", () => {
    ;({ container, root } = mountComposer({ runActive: true }))

    setDraft(textarea(container!), "steer now")

    const queue = queueButton(container!)
    const sendNow = container!.querySelector(
      'button[aria-label="Send now"]',
    ) as HTMLButtonElement
    const stop = container!.querySelector(
      'button[aria-label="Stop"]',
    ) as HTMLButtonElement

    expect(queue).toBeTruthy()
    expect(sendNow).toBeTruthy()
    expect(stop).toBeTruthy()
    expect(queue.className).toMatch(/\bh-11\b/)
    expect(queue.className).toMatch(/\bshell:h-9\b/)
    expect(queue.className).toMatch(/\bshell:w-9\b/)
    expect(sendNow.className).toMatch(/\bh-11\b/)
    expect(sendNow.className).toMatch(/\bshell:h-9\b/)
    expect(sendNow.className).toMatch(/\bshell:w-9\b/)
    expect(stop.className).toMatch(/\bh-11\b/)
    expect(stop.className).toMatch(/\bshell:h-9\b/)
    expect(stop.className).toMatch(/\bshell:w-9\b/)

    act(() => {
      sendNow.click()
    })

    expect(interruptMutate).toHaveBeenCalledTimes(1)
    expect(interruptMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: { prompt: "steer now", model: "composer-2.5-fast" },
      },
      expect.any(Object),
    )
  })

  it("wraps the control row and keeps the model picker from collapsing", () => {
    ;({ container, root } = mountComposer({ runActive: true }))

    setDraft(textarea(container!), "steer now")

    const row = container!.querySelector(
      '[data-testid="composer-control-row"]',
    )
    expect(row?.className).toMatch(/\bflex-wrap\b/)

    const picker = container!.querySelector(
      'button[aria-label="Model"]',
    ) as HTMLButtonElement
    expect(picker.className).toMatch(/min-w-\[8rem\]/)
    expect(picker.className).not.toMatch(/\bmin-w-0\b/)
  })
})

describe("Composer post-send focus", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
    interruptMutate.mockClear()
    coarsePointer.value = false
  })

  it("refocuses the textarea after a successful send via Enter", () => {
    sendMutate.mockImplementation((_args, opts) => {
      opts?.onSuccess?.()
    })
    coarsePointer.value = false
    ;({ container, root } = mountComposer())

    const input = textarea(container!)
    setDraft(input, "Hello")
    act(() => {
      input.blur()
    })
    expect(document.activeElement).not.toBe(input)

    pressEnter(input)

    expect(document.activeElement).toBe(input)
  })

  it("refocuses the textarea after a successful send via the send control", () => {
    sendMutate.mockImplementation((_args, opts) => {
      opts?.onSuccess?.()
    })
    ;({ container, root } = mountComposer())

    const input = textarea(container!)
    setDraft(input, "Hello")
    act(() => {
      input.blur()
    })
    expect(document.activeElement).not.toBe(input)

    act(() => {
      sendButton(container!).click()
    })

    expect(document.activeElement).toBe(input)
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
    sendMutate.mockClear()
    interruptMutate.mockClear()
    coarsePointer.value = false
    localStorage.clear()
    vi.useRealTimers()
  })

  it("restores the draft after remount for the same conversation", () => {
    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    setDraft(textarea(container!), "Long in-progress reply")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(localStorage.getItem(composerDraftStorageKey("conv-a"))).toBe(
      "Long in-progress reply",
    )

    act(() => root!.unmount())
    container!.remove()
    container = undefined
    root = undefined

    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    expect(textarea(container!).value).toBe("Long in-progress reply")
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

  it("clears storage on successful send", () => {
    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    setDraft(textarea(container!), "Ready to send")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(localStorage.getItem(composerDraftStorageKey("conv-a"))).toBe(
      "Ready to send",
    )

    sendMutate.mockImplementation((_args, opts) => {
      opts?.onSuccess?.()
    })

    act(() => {
      sendButton(container!).click()
    })

    expect(localStorage.getItem(composerDraftStorageKey("conv-a"))).toBeNull()
    expect(textarea(container!).value).toBe("")
  })

  it("clears storage when the draft field is emptied", () => {
    ;({ container, root } = mountComposer({ conversationId: "conv-a" }))

    setDraft(textarea(container!), "Will delete")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(localStorage.getItem(composerDraftStorageKey("conv-a"))).toBe(
      "Will delete",
    )

    setDraft(textarea(container!), "")
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(localStorage.getItem(composerDraftStorageKey("conv-a"))).toBeNull()
  })
})

function stubDesktopViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  })
  window.matchMedia = vi.fn((query: string) => {
    const matches = query === "(max-width: 859px)" ? false : false
    const mql: MediaQueryList = {
      media: query,
      matches,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
    return mql
  })
}

function grip(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('[data-testid="composer-resize-grip"]')
  expect(el).toBeTruthy()
  return el as HTMLButtonElement
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

describe("Composer height persistence", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let pane: HTMLDivElement | undefined
  const paneHeight = { value: 500 }
  const scrollHeights: Record<string, number> = {}
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "scrollHeight",
  )

  function mountInPane(conversationId = "conv-a") {
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
          conversationId={conversationId}
          model="composer-2.5-fast"
          runActive={false}
        />,
      )
    })
  }

  beforeEach(() => {
    paneHeight.value = 500
    for (const key of Object.keys(scrollHeights)) delete scrollHeights[key]
    stubDesktopViewport()
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
    localStorage.clear()
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

  it("writes the height when a drag ends", () => {
    scrollHeights[""] = 44
    mountInPane()

    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", 340)
    dispatchPointer(handle, "pointerup", 340)

    expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBe("104")
  })

  it("restores the height after remount and ignores content sizing", () => {
    scrollHeights[""] = 44
    scrollHeights["taller draft"] = 120
    mountInPane()

    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", 340)
    dispatchPointer(handle, "pointerup", 340)

    expect(textarea(container!).style.height).toBe("104px")

    act(() => root!.unmount())
    container!.remove()
    container = undefined
    root = undefined

    mountInPane()

    const input = textarea(container!)
    expect(input.style.height).toBe("104px")

    setDraft(input, "taller draft")
    expect(input.style.height).toBe("104px")
  })

  it("applies the same stored height after switching conversations", () => {
    scrollHeights[""] = 44
    mountInPane("conv-a")

    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", 340)
    dispatchPointer(handle, "pointerup", 340)

    act(() => {
      root!.render(
        <Composer
          conversationId="conv-b"
          model="composer-2.5-fast"
          runActive={false}
        />,
      )
    })

    expect(textarea(container!).style.height).toBe("104px")
  })

  it("clears stored height on grip double-click and resumes content sizing", () => {
    scrollHeights[""] = 44
    scrollHeights["taller draft"] = 120
    mountInPane()

    const handle = grip(container!)
    dispatchPointer(handle, "pointerdown", 400)
    dispatchPointer(handle, "pointermove", 340)
    dispatchPointer(handle, "pointerup", 340)

    expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBe("104")

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      )
    })

    expect(localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY)).toBeNull()

    const input = textarea(container!)
    setDraft(input, "taller draft")
    expect(input.style.height).toBe("120px")
  })
})

describe("Composer disabled rewrite", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
  })

  it("keeps the field visible and refuses input during a rewrite", () => {
    ;({ container, root } = mountComposer({
      disabled: true,
      disabledPlaceholder: "Message disabled while rewrite runs...",
      runActive: true,
    }))
    const input = textarea(container!)
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe("Message disabled while rewrite runs...")
    expect(
      container!.querySelector('[data-composer-disabled="true"]'),
    ).toBeTruthy()
    expect(container!.querySelector('[aria-label="Stop"]')).toBeNull()
  })
})
