import { useAgentModelsQuery } from "@/features/agents/api/queries";
import { useCreateChannelSession } from "../api/mutations";
import {
  exportSessionMessage,
  exportSessionTitle,
} from "../lib/export-launch";
import { implementingSessionModel } from "@server/services/implementing-launch";

/** POST an export session with the rewrite bootstrap. Archives the prior one. */
export function useStartExportSession(issue: { id: string; title: string }) {
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const createSession = useCreateChannelSession(issue.id, "export");
  const model = implementingSessionModel(modelsData?.models ?? []);
  const pending = createSession.isPending;
  const modelReady = Boolean(model) && !modelsLoading;

  const start = (handlers?: {
    onSuccess?: (session: { id: string }) => void;
    onError?: () => void;
  }) => {
    if (!model || !modelReady || pending) return;
    createSession.mutate(
      {
        model,
        title: exportSessionTitle(issue.title),
        message: exportSessionMessage(issue.id),
      },
      {
        onSuccess: ({ id }) => handlers?.onSuccess?.({ id }),
        onError: () => handlers?.onError?.(),
      },
    );
  };

  return { start, pending, modelReady };
}
