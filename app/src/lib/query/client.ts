import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
