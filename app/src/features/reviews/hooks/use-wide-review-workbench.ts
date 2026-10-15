import { useEffect, useState } from "react";

/** Matches the workbench `shell` breakpoint: wider than this expands a card. */
export const REVIEW_WORKBENCH_WIDE_PX = 860;

/**
 * True at the workbench's `shell` breakpoint and above. Undefined until the
 * viewport is measured, so a phone does not paint an expanded transcript first.
 */
export function useWideReviewWorkbench(): boolean | undefined {
  const [wide, setWide] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const query = `(min-width: ${REVIEW_WORKBENCH_WIDE_PX}px)`;
    const mql = window.matchMedia(query);
    const apply = () => setWide(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  return wide;
}
