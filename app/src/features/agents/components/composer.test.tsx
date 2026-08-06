// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"

const sendMutate = vi.fn()

vi.mock("../api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: sendMutate,
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

function mountComposer(): {
  container: HTMLDivElement
  root: Root
} {
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

describe("Composer Enter key", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
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
