import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { OutlineMockupStackStatus } from "@server/schemas";
import { request } from "@/lib/api/client";
import { issuesKeys } from "./keys";

function outlineMockupsUrl(outlineId: string): string {
  return `/api/issues/${encodeURIComponent(outlineId)}/mockups`;
}

/** Public Storybook path for the outline's bound session. */
export function outlineStorybookPath(sessionId: string): string {
  return `/mockups/${encodeURIComponent(sessionId)}/`;
}

export function fetchOutlineMockupStack(
  outlineId: string,
): Promise<OutlineMockupStackStatus> {
  return request<OutlineMockupStackStatus>(outlineMockupsUrl(outlineId));
}

export function startOutlineMockupStack(
  outlineId: string,
): Promise<OutlineMockupStackStatus> {
  return request<OutlineMockupStackStatus>(outlineMockupsUrl(outlineId), {
    method: "POST",
  });
}

export function stopOutlineMockupStack(
  outlineId: string,
): Promise<OutlineMockupStackStatus> {
  return request<OutlineMockupStackStatus>(outlineMockupsUrl(outlineId), {
    method: "DELETE",
  });
}

export function useOutlineMockupStackQuery(
  outlineId: string | undefined,
  options?: { refetchInterval?: number | false },
): UseQueryResult<OutlineMockupStackStatus, Error> {
  return useQuery({
    queryKey: issuesKeys.outlineMockups(outlineId ?? ""),
    queryFn: () => fetchOutlineMockupStack(outlineId!),
    enabled: Boolean(outlineId),
    refetchInterval: options?.refetchInterval,
  });
}

function useOutlineMockupStackMutation(
  outlineId: string,
  run: (outlineId: string) => Promise<OutlineMockupStackStatus>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => run(outlineId),
    onSuccess: (status) => {
      queryClient.setQueryData(issuesKeys.outlineMockups(outlineId), status);
    },
  });
}

export function useStartOutlineMockupStack(outlineId: string) {
  return useOutlineMockupStackMutation(outlineId, startOutlineMockupStack);
}

export function useStopOutlineMockupStack(outlineId: string) {
  return useOutlineMockupStackMutation(outlineId, stopOutlineMockupStack);
}
