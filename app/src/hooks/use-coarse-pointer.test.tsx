// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIsCoarsePointer } from "./use-coarse-pointer"

function mockCoarsePointer(initialMatches: boolean) {
  const state = { matches: initialMatches }
  const listeners = new Set<() => void>()

  window.matchMedia = vi.fn((query: string) => {
    const mql = {
      media: query,
      get matches() {
        return query === "(pointer: coarse)" ? state.matches : false
      },
      addEventListener: (_event: string, cb: () => void) => {
        listeners.add(cb)
      },
      removeEventListener: (_event: string, cb: () => void) => {
        listeners.delete(cb)
      },
    }
    return mql as MediaQueryList
  })

  return {
    setMatches(next: boolean) {
      state.matches = next
      for (const cb of listeners) cb()
    },
  }
}

function mountProbe(onValue: (value: boolean) => void): {
  container: HTMLDivElement
  root: Root
} {
  function Probe() {
    const isCoarse = useIsCoarsePointer()
    React.useEffect(() => {
      onValue(isCoarse)
    }, [isCoarse])
    return null
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<Probe />)
  })
  return { container, root }
}

describe("useIsCoarsePointer", () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = undefined
    root = undefined
    vi.restoreAllMocks()
  })

  it("reports false when the coarse pointer query does not match", () => {
    mockCoarsePointer(false)
    const values: boolean[] = []
    ;({ container, root } = mountProbe((value) => values.push(value)))

    expect(values.at(-1)).toBe(false)
  })

  it("reports true when the coarse pointer query matches", () => {
    mockCoarsePointer(true)
    const values: boolean[] = []
    ;({ container, root } = mountProbe((value) => values.push(value)))

    expect(values.at(-1)).toBe(true)
  })

  it("updates when the media query changes", () => {
    const media = mockCoarsePointer(false)
    const values: boolean[] = []
    ;({ container, root } = mountProbe((value) => values.push(value)))

    act(() => {
      media.setMatches(true)
    })

    expect(values.at(-1)).toBe(true)
  })
})
