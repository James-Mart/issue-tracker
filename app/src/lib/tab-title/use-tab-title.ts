import { useLayoutEffect } from "react";
import { formatTabTitle } from "./format-tab-title";

/** Entity name for a tab title. The route id stands in until that name is known. */
export function tabTitleEntityName(
  name: string | undefined,
  routeId: string,
): string {
  return name ?? routeId;
}

export function useTabTitle(name: string, suffix?: string): void {
  useLayoutEffect(() => {
    const previous = document.title;
    document.title = formatTabTitle({ name, suffix });
    return () => {
      document.title = previous;
    };
  }, [name, suffix]);
}
