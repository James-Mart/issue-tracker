import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type { BackupConfig } from "@server/schemas";
import type { BackupSurfaceState } from "@server/services/store-backup-status";
import { backupKeys } from "./keys";

export type BackupStatus = {
  state: BackupSurfaceState;
  lastSuccessAt: string | null;
  error: string | null;
};

export type BackupResponse = {
  config: BackupConfig;
  status: BackupStatus;
};

export function useBackupQuery(): UseQueryResult<BackupResponse, Error> {
  return useQuery({
    queryKey: backupKeys.current(),
    queryFn: () => request<BackupResponse>("/api/backup"),
  });
}
