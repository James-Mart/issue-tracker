// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Composer } from "./composer"

const sendMutate = vi.fn()
const uploadMutateAsync = vi.fn()
const deleteMutateAsync = vi.fn()

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
    mutateAsync: uploadMutateAsync,
    isPending: false,
  }),
  useDeleteConversationAttachment: () => ({
    mutateAsync: deleteMutateAsync,
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

function sendButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('button[aria-label="Send"]')
  expect(el).toBeTruthy()
  return el as HTMLButtonElement
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

function fileClipboardData(files: File[]) {
  return {
    files,
    items: files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    })),
    types: ["Files"],
  }
}

function fileDataTransfer(files: File[] = [new File(["x"], "notes.txt")]) {
  return {
    files,
    items: files.map((file) => ({
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    })),
    types: files.length > 0 ? ["Files"] : [],
    dropEffect: "none",
  }
}

function dispatchPaste(target: EventTarget, files: File[]): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: fileClipboardData(files),
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function dispatchDrag(
  target: EventTarget,
  type: "dragenter" | "dragleave" | "dragover" | "drop",
  dataTransfer: ReturnType<typeof fileDataTransfer> = fileDataTransfer(),
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe("Composer attachments", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    sendMutate.mockClear()
    uploadMutateAsync.mockReset()
    deleteMutateAsync.mockReset()
  })

  it("stages a chip when a file is picked", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "notes.txt",
      size: 12,
      mimeType: "text/plain",
    })
    ;({ container, root } = mountComposer())

    const file = new File(["hello world"], "notes.txt", { type: "text/plain" })
    pickFile(fileInput(container!), file)

    await act(async () => {
      await Promise.resolve()
    })

    expect(uploadMutateAsync).toHaveBeenCalledWith(file)
    expect(
      container!.querySelector('[data-testid="staged-attachments"]'),
    ).toBeTruthy()
    expect(
      container!.querySelector('[data-testid="staged-attachment-notes.txt"]'),
    ).toBeTruthy()
    const fileChip = container!.querySelector(
      '[data-staged-kind="file"]',
    ) as HTMLElement
    expect(fileChip).toBeTruthy()
    expect(fileChip.className).toMatch(/\bmin-h-11\b/)
    expect(fileChip.className).toMatch(/\bshell:min-h-9\b/)
  })

  it("aligns image chips to the control height scale", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "palette.png",
      size: 100,
      mimeType: "image/png",
    })
    ;({ container, root } = mountComposer())

    pickFile(
      fileInput(container!),
      new File(["pixels"], "palette.png", { type: "image/png" }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    const thumb = container!
      .querySelector('[data-staged-kind="image"]')
      ?.querySelector(".relative") as HTMLElement
    expect(thumb).toBeTruthy()
    expect(thumb.className).toMatch(/\bh-11\b/)
    expect(thumb.className).toMatch(/\bw-11\b/)
    expect(thumb.className).toMatch(/\bshell:h-9\b/)
    expect(thumb.className).toMatch(/\bshell:w-9\b/)
  })

  it("removes a staged chip and deletes the attachment", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "notes.txt",
      size: 12,
      mimeType: "text/plain",
    })
    deleteMutateAsync.mockResolvedValue(undefined)
    ;({ container, root } = mountComposer())

    const file = new File(["hello world"], "notes.txt", { type: "text/plain" })
    pickFile(fileInput(container!), file)

    await act(async () => {
      await Promise.resolve()
    })

    const remove = container!.querySelector(
      'button[aria-label="Remove notes.txt"]',
    ) as HTMLButtonElement

    await act(async () => {
      remove.click()
      await Promise.resolve()
    })

    expect(deleteMutateAsync).toHaveBeenCalledWith("notes.txt")
    expect(
      container!.querySelector('[data-testid="staged-attachments"]'),
    ).toBeNull()
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

  it("sends staged attachment names and clears staged state on success", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "notes.txt",
      size: 12,
      mimeType: "text/plain",
    })
    sendMutate.mockImplementation((_args, opts) => {
      opts?.onSuccess?.()
    })
    ;({ container, root } = mountComposer())

    pickFile(
      fileInput(container!),
      new File(["hello world"], "notes.txt", { type: "text/plain" }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(sendButton(container!).disabled).toBe(false)

    act(() => {
      sendButton(container!).click()
    })

    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "conv-1",
        body: {
          prompt: "",
          model: "composer-2.5-fast",
          attachments: ["notes.txt"],
        },
      },
      expect.any(Object),
    )
    expect(
      container!.querySelector('[data-testid="staged-attachments"]'),
    ).toBeNull()
  })
})

describe("Composer paste and drop", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    uploadMutateAsync.mockReset()
    deleteMutateAsync.mockReset()
  })

  it("stages a chip on paste and leaves the draft text alone", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "shot.png",
      size: 20,
      mimeType: "image/png",
    })
    ;({ container, root } = mountComposer())

    setDraft(textarea(container!), "Keep this draft")
    const file = new File(["pixels"], "shot.png", { type: "image/png" })
    const event = dispatchPaste(textarea(container!), [file])

    await act(async () => {
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(uploadMutateAsync).toHaveBeenCalledWith(file)
    expect(
      container!.querySelector('[data-testid="staged-attachment-shot.png"]'),
    ).toBeTruthy()
    expect(textarea(container!).value).toBe("Keep this draft")
  })

  it("stages a chip on drop", async () => {
    uploadMutateAsync.mockResolvedValue({
      name: "notes.txt",
      size: 12,
      mimeType: "text/plain",
    })
    ;({ container, root } = mountComposer())

    const composer = container!.querySelector(
      '[data-testid="conversation-composer"]',
    )!
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" })
    dispatchDrag(composer, "drop", fileDataTransfer([file]))

    await act(async () => {
      await Promise.resolve()
    })

    expect(uploadMutateAsync).toHaveBeenCalledWith(file)
    expect(
      container!.querySelector('[data-testid="staged-attachment-notes.txt"]'),
    ).toBeTruthy()
  })

  it("keeps the drag-active state when enter then leave happen over a child", () => {
    ;({ container, root } = mountComposer())

    const composer = container!.querySelector(
      '[data-testid="conversation-composer"]',
    )!
    const child = textarea(container!)

    dispatchDrag(composer, "dragenter")
    expect(
      container!.querySelector('[data-testid="composer-drag-active"]'),
    ).toBeTruthy()

    dispatchDrag(child, "dragenter")
    dispatchDrag(child, "dragleave")
    expect(
      container!.querySelector('[data-testid="composer-drag-active"]'),
    ).toBeTruthy()

    dispatchDrag(composer, "dragleave")
    expect(
      container!.querySelector('[data-testid="composer-drag-active"]'),
    ).toBeNull()
  })
})
