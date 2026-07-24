import { useEffect, useRef, useState } from "react";
import type { IssueDetail } from "@server/schemas";

export interface ExternalEditConflict {
  hasConflict: boolean;
  acknowledge: () => void;
}

export function useExternalEditConflict(
  issue: IssueDetail,
  sessionActive = true,
): ExternalEditConflict {
  const [baseline, setBaseline] = useState(issue.version);
  const versionRef = useRef(issue.version);
  versionRef.current = issue.version;

  useEffect(() => {
    if (sessionActive) {
      setBaseline(versionRef.current);
    }
  }, [sessionActive]);

  return {
    hasConflict: sessionActive && issue.version !== baseline,
    acknowledge: () => setBaseline(issue.version),
  };
}
