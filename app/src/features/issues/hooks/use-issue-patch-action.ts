import { useRef, useState } from "react";

export interface IssuePatchAction {
  error: string | null;
  saving: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}

/** Shared saving/error wrapper for non-text immediate issue patches. */
export function useIssuePatchAction(): IssuePatchAction {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const run = async (action: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return { error, saving, run };
}
