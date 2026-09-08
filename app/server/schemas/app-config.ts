import { z } from "zod";
import { formatZodError } from "./issue.js";

// --- App config (peer of issues/; runtime-edited settings) ---

export const backupConfigSchema = z.object({
  remote: z.string().nullable(),
  enabled: z.boolean(),
});

export const backupPutBodySchema = z
  .object({
    remote: z.string(),
    enabled: z.boolean(),
  })
  .strict();

export type BackupPutBody = z.infer<typeof backupPutBodySchema>;

export const appConfigSchema = z
  .object({
    backup: backupConfigSchema.optional(),
  })
  .passthrough();

export type BackupConfig = z.infer<typeof backupConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

export type AppConfigParseResult =
  | { ok: true; config: AppConfig }
  | { ok: false; message: string };

export function parseAppConfig(raw: unknown): AppConfigParseResult {
  const result = appConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    message: formatZodError(result.error, "invalid app-config.json"),
  };
}
