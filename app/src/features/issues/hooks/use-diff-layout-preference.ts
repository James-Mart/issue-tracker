import { useCallback, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  effectiveDiffLayout,
  readStoredDiffLayout,
  writeStoredDiffLayout,
  type DiffLayout,
} from "../lib/diff-layout-preference";

/** `layout` is the stored choice; `diffLayout` is what renders (always unified on mobile). */
export function useDiffLayoutPreference(): {
  layout: DiffLayout;
  setLayout: (layout: DiffLayout) => void;
  diffLayout: DiffLayout;
  isMobile: boolean;
} {
  const isMobile = useIsMobile();
  const [layout, setLayoutState] = useState<DiffLayout>(() => readStoredDiffLayout());
  const setLayout = useCallback((next: DiffLayout) => {
    writeStoredDiffLayout(next);
    setLayoutState(next);
  }, []);
  return { layout, setLayout, diffLayout: effectiveDiffLayout(layout, isMobile), isMobile };
}
