import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffsWorkerPoolProvider } from "@/lib/diffs/diffs-worker-pool-provider";
import { createQueryClient } from "@/lib/query/client";
import { APP_THEME } from "@/lib/theme/theme";
import { ErrorFallback } from "./error-fallback";

interface Props {
  children: ReactNode;
}

export function Providers({ children }: Props) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <DiffsWorkerPoolProvider>{children}</DiffsWorkerPoolProvider>
        </ErrorBoundary>
        <Toaster theme={APP_THEME} richColors position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
