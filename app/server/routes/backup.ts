import { Router } from "express";
import { readAppConfig, writeBackupConfig } from "../app-config.js";
import {
  backupPutBodySchema,
  formatZodError,
  type BackupConfig,
} from "../schemas.js";
import { IssueError } from "../services/errors.js";
import {
  deriveBackupSurfaceState,
  readBackupStatus,
} from "../services/store-backup-status.js";

const emptyConfig = (): BackupConfig => ({ remote: null, enabled: false });

function backupPayload() {
  const config = readAppConfig().backup ?? emptyConfig();
  const engine = readBackupStatus();
  return {
    config,
    status: {
      state: deriveBackupSurfaceState(config.remote, engine),
      lastSuccessAt: engine.lastSuccessAt,
      error: engine.error,
    },
  };
}

export function createBackupRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(backupPayload());
  });

  router.put("/", (req, res) => {
    const parsed = backupPutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new IssueError(
        "validation",
        formatZodError(parsed.error, "invalid backup body"),
      );
    }
    writeBackupConfig(parsed.data);
    res.json(backupPayload());
  });

  return router;
}
