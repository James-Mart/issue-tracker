import type { FallbackProps } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { ShellFaultDetail, ShellState } from "./shell-state";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <PageShell className="items-start py-16">
      <ShellState
        className="w-full"
        tone="blocked"
        eyebrow="Fault"
        title="This view crashed."
        detail={
          <ShellFaultDetail
            message={message}
            hint="Reload this view to continue."
          />
        }
        action={
          <Button variant="primary" onClick={resetErrorBoundary}>
            Try again
          </Button>
        }
      />
    </PageShell>
  );
}
