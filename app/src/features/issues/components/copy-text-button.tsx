import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const COPIED_RESET_MS = 1500;

/** Icon button that copies `text`. A denied clipboard leaves the copy icon and reports a toast. */
export function CopyTextButton({
  text,
  label,
  testId,
  className,
}: {
  text: string;
  /** Accessible name and tooltip. The button has no visible text. */
  label: string;
  testId?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetCopiedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current !== undefined) {
        clearTimeout(resetCopiedRef.current);
      }
    };
  }, []);

  const clearReset = () => {
    if (resetCopiedRef.current !== undefined) {
      clearTimeout(resetCopiedRef.current);
      resetCopiedRef.current = undefined;
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={label}
      title={label}
      data-testid={testId}
      data-copied={copied ? "" : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearReset();
          resetCopiedRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
        } catch {
          // The browser can deny the clipboard. Leave the copy icon and say so.
          clearReset();
          setCopied(false);
          toast.error("Could not copy to clipboard");
        }
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}
