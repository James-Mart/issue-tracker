import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "@/lib/api/client";
import type { BackupPutBody } from "@server/schemas";
import { backupKeys } from "./keys";
import type { BackupResponse } from "./queries";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

export function useUpdateBackup() {
  const qc = useQueryClient();
  return useMutation<BackupResponse, Error, BackupPutBody>({
    mutationFn: (body) =>
      request<BackupResponse>("/api/backup", { method: "PUT", body }),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (data) => qc.setQueryData(backupKeys.current(), data),
  });
}
