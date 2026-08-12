// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"
import { composerDraftStorageKey } from "../lib/composer-draft-storage"

const sendMutate = vi.fn()
const interruptMutate = vi.fn()

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
}))

vi.mock("../api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: {
      models: [{ id: "composer-2.5-fast", displayName: "Composer" }],
    },
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
    expect(sendNow.className).toMatch(/\bh-11\b/)
    expect(stop.className).toMatch(/\bh-11\b/)

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
