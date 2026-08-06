import * as React from "react"

const COARSE_POINTER_QUERY = "(pointer: coarse)"

export function useIsCoarsePointer() {
  const [isCoarse, setIsCoarse] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(COARSE_POINTER_QUERY)
    const onChange = () => {
      setIsCoarse(mql.matches)
    }
    mql.addEventListener("change", onChange)
    setIsCoarse(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isCoarse
}
