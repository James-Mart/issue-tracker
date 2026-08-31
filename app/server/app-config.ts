import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { appConfigPath } from "./config.js";
import {
  appConfigSchema,
  formatZodError,
  parseAppConfig,
  type AppConfig,
  type BackupConfig,
} from "./schemas.js";

export type { AppConfig, BackupConfig };

export type ReadAppConfigOptions = {
  configPath?: string;
};

export type WriteBackupConfigOptions = {
  configPath?: string;
};

function parseAppConfigFile(raw: string, configPath: string): AppConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`app-config.json at ${configPath} is not valid JSON`);
  }
  const result = parseAppConfig(parsed);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.config;
}

/** Read persisted app config. Absent file means unconfigured; corrupt file throws. */
export function readAppConfig(
  options: ReadAppConfigOptions = {},
): AppConfig {
  const path = options.configPath ?? appConfigPath;
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  return parseAppConfigFile(raw, path);
}

/** Replace only the backup section, preserving every other top-level key. */
export function writeBackupConfig(
  backup: BackupConfig,
  options: WriteBackupConfigOptions = {},
): void {
  const path = options.configPath ?? appConfigPath;
  const existing = existsSync(path)
    ? parseAppConfigFile(readFileSync(path, "utf8"), path)
    : {};
  const merged = { ...existing, backup };
  const validated = appConfigSchema.safeParse(merged);
  if (!validated.success) {
    throw new Error(formatZodError(validated.error, "invalid app-config.json"));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(validated.data, null, 2)}\n`);
}
