import { useLayoutEffect } from "react";
import { formatTabTitle } from "./format-tab-title";

export function useTabTitle(name: string, suffix?: string): void {
  useLayoutEffect(() => {
    const previous = document.title;
    document.title = formatTabTitle({ name, suffix });
    return () => {
      document.title = previous;
    };
  }, [name, suffix]);
}
