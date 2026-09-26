import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { SECRET_KEY_RE } from "../issue-constants.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Directory holding per-Project secret JSON files. */
export function secretsDir(): string {
  return join(homedir(), ".config", "issue-tracker", "secrets");
}

/** On-disk path for one Project's secret store file. */
export function secretFilePath(projectId: string): string {
  return join(secretsDir(), `${projectId}.json`);
}

export function assertSecretKey(key: string): void {
  if (!SECRET_KEY_RE.test(key)) {
    throw new Error(
      `invalid secret key "${key}" (expected ^[A-Z_][A-Z0-9_]*$)`,
    );
  }
}

function assertModeNoGroupOther(path: string, maxLabel: string): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${maxLabel} has permissions wider than expected: ${path}`);
  }
}

function assertSecretFileMode(path: string): void {
  assertModeNoGroupOther(path, "secret store file");
}

function assertSecretsDirMode(dir: string): void {
  assertModeNoGroupOther(dir, "secret store directory");
}

function readSecretsFile(projectId: string): Record<string, string> {
  const path = secretFilePath(projectId);
  if (!existsSync(path)) return {};
  assertSecretFileMode(path);
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`secret store file is not valid JSON: ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`secret store file must be a JSON object: ${path}`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    assertSecretKey(key);
    if (typeof value !== "string") {
      throw new Error(`secret "${key}" must be a string value`);
    }
    result[key] = value;
  }
  return result;
}

function writeSecretsFile(
  projectId: string,
  secrets: Record<string, string>,
): void {
  const dir = secretsDir();
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  assertSecretsDirMode(dir);
  const path = secretFilePath(projectId);
  if (Object.keys(secrets).length === 0) {
    if (existsSync(path)) rmSync(path);
    return;
  }
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, {
    mode: FILE_MODE,
  });
  chmodSync(path, FILE_MODE);
}

/** Sorted key names for one Project; never returns secret values. */
export function listSecretKeys(projectId: string): string[] {
  return Object.keys(readSecretsFile(projectId)).sort();
}

export function setSecret(
  projectId: string,
  key: string,
  value: string,
): void {
  assertSecretKey(key);
  const secrets = readSecretsFile(projectId);
  secrets[key] = value;
  writeSecretsFile(projectId, secrets);
}

export function deleteSecret(projectId: string, key: string): void {
  assertSecretKey(key);
  const secrets = readSecretsFile(projectId);
  delete secrets[key];
  writeSecretsFile(projectId, secrets);
}

/** Full key/value map for runtime injection; refuses overly permissive files. */
export function readSecretsForRuntime(
  projectId: string,
): Record<string, string> {
  return readSecretsFile(projectId);
}

/** Summary/view line listing secret key names only. */
export function formatSecretsLine(keys: string[]): string {
  return keys.join(", ");
}
