import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query/client";
import { useTheme } from "@/lib/theme/use-theme";
import { ErrorFallback } from "./error-fallback";

interface Props {
  children: ReactNode;
}

export function Providers({ children }: Props) {
  const [queryClient] = useState(createQueryClient);
  const { theme } = useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          {children}
        </ErrorBoundary>
        <Toaster theme={theme} richColors position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
