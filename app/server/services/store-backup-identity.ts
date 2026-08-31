import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  ensureOriginRemote as defaultEnsureOriginRemote,
  fetchOrigin as defaultFetchOrigin,
  lsRemoteOrigin as defaultLsRemoteOrigin,
  pushMainToOrigin as defaultPushMainToOrigin,
  showFileAtRef as defaultShowFileAtRef,
} from "./git-write.js";

export const BACKUP_IDENTITY_FILENAME = "backup-identity.json";

export type BackupIdentity = {
  storeId: string;
};

export type BackupProblem = {
  kind: "diverged";
  localStoreId: string;
  remoteStoreId: string | null;
  message: string;
};

export type StoreBackupIdentityGit = {
  ensureOriginRemote: (workspace: string, url: string) => Promise<void>;
  lsRemoteOrigin: (workspace: string) => Promise<string>;
  fetchOrigin: (workspace: string) => Promise<void>;
  showFileAtRef: (workspace: string, spec: string) => Promise<string>;
  pushMainToOrigin: (workspace: string) => Promise<void>;
};

const defaultGit: StoreBackupIdentityGit = {
  ensureOriginRemote: defaultEnsureOriginRemote,
  lsRemoteOrigin: defaultLsRemoteOrigin,
  fetchOrigin: defaultFetchOrigin,
  showFileAtRef: defaultShowFileAtRef,
  pushMainToOrigin: defaultPushMainToOrigin,
};

let currentBackupProblem: BackupProblem | null = null;

export function getCurrentBackupProblem(): BackupProblem | null {
  return currentBackupProblem;
}

function recordBackupProblem(problem: BackupProblem): void {
  currentBackupProblem = problem;
}

/** @internal Reset recorded problem between tests. */
export function resetCurrentBackupProblemForTests(): void {
  currentBackupProblem = null;
}

function clearCurrentBackupProblem(): void {
  currentBackupProblem = null;
}

export function parseBackupIdentity(raw: string): BackupIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("backup-identity.json is not valid JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("storeId" in parsed) ||
    typeof parsed.storeId !== "string" ||
    parsed.storeId.length === 0
  ) {
    throw new Error("backup-identity.json is missing a storeId");
  }
  return { storeId: parsed.storeId };
}

export function formatBackupIdentity(identity: BackupIdentity): string {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

/** Write `backup-identity.json` at the mirror root if it is not already there. */
export function ensureBackupIdentity(
  mirrorDir: string,
  generateId: () => string = randomUUID,
): BackupIdentity {
  const path = join(mirrorDir, BACKUP_IDENTITY_FILENAME);
  if (existsSync(path)) {
    return parseBackupIdentity(readFileSync(path, "utf8"));
  }
  mkdirSync(mirrorDir, { recursive: true });
  const identity = { storeId: generateId() };
  writeFileSync(path, formatBackupIdentity(identity));
  return identity;
}

function remoteIdentitySpec(): string {
  return `origin/main:${BACKUP_IDENTITY_FILENAME}`;
}

function refuseDivergence(
  localStoreId: string,
  remoteStoreId: string | null,
  message: string,
): "refused" {
  recordBackupProblem({
    kind: "diverged",
    localStoreId,
    remoteStoreId,
    message,
  });
  return "refused";
}

/**
 * Push `main` only when the remote is empty or already holds this store's
 * identity. A different `storeId` is recorded and the push is skipped.
 */
export async function pushMirrorIfAllowed(
  workspace: string,
  remoteUrl: string,
  localStoreId: string,
  git: StoreBackupIdentityGit = defaultGit,
): Promise<"pushed" | "refused"> {
  await git.ensureOriginRemote(workspace, remoteUrl);

  const refs = await git.lsRemoteOrigin(workspace);
  if (refs.trim().length === 0) {
    await git.pushMainToOrigin(workspace);
    clearCurrentBackupProblem();
    return "pushed";
  }

  await git.fetchOrigin(workspace);

  let raw: string;
  try {
    raw = await git.showFileAtRef(workspace, remoteIdentitySpec());
  } catch {
    return refuseDivergence(
      localStoreId,
      null,
      "Remote has history but is not this store's mirror",
    );
  }

  let remoteIdentity: BackupIdentity;
  try {
    remoteIdentity = parseBackupIdentity(raw);
  } catch {
    return refuseDivergence(
      localStoreId,
      null,
      "Remote has history but is not this store's mirror",
    );
  }

  if (remoteIdentity.storeId !== localStoreId) {
    return refuseDivergence(
      localStoreId,
      remoteIdentity.storeId,
      `Remote store identity differs from this machine (local ${localStoreId}, remote ${remoteIdentity.storeId})`,
    );
  }

  await git.pushMainToOrigin(workspace);
  clearCurrentBackupProblem();
  return "pushed";
}
