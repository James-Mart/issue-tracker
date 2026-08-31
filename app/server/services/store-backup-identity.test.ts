import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_IDENTITY_FILENAME,
  ensureBackupIdentity,
  getCurrentBackupProblem,
  parseBackupIdentity,
  pushMirrorIfAllowed,
  resetCurrentBackupProblemForTests,
  type StoreBackupIdentityGit,
} from "./store-backup-identity.js";

let tempRoots: string[] = [];

afterEach(() => {
  resetCurrentBackupProblemForTests();
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

function tempMirrorDir(): string {
  const root = mkdtempSync(join(tmpdir(), "backup-identity-"));
  tempRoots.push(root);
  return root;
}

function stubGit(overrides: Partial<StoreBackupIdentityGit> = {}): {
  git: StoreBackupIdentityGit;
  calls: string[];
} {
  const calls: string[] = [];
  const git: StoreBackupIdentityGit = {
    ensureOriginRemote: async () => {
      calls.push("ensureOriginRemote");
    },
    lsRemoteOrigin: async () => {
      calls.push("lsRemoteOrigin");
      return "";
    },
    fetchOrigin: async () => {
      calls.push("fetchOrigin");
    },
    showFileAtRef: async () => {
      calls.push("showFileAtRef");
      return '{"storeId":"local-store"}\n';
    },
    pushMainToOrigin: async () => {
      calls.push("pushMainToOrigin");
    },
    ...overrides,
  };
  return { git, calls };
}

const LOCAL_STORE_ID = "5f6c1e64-9c0a-4f7e-9b6b-2f2a1d3c4e5f";
const REMOTE_URL = "git@github.com:me/tracker-backup.git";

describe("ensureBackupIdentity", () => {
  it("writes a stable identity at the mirror root outside issues/", () => {
    const mirrorDir = tempMirrorDir();
    mkdirSync(join(mirrorDir, "issues"), { recursive: true });

    const first = ensureBackupIdentity(mirrorDir, () => LOCAL_STORE_ID);
    const second = ensureBackupIdentity(mirrorDir, () => "should-not-run");

    expect(first).toEqual({ storeId: LOCAL_STORE_ID });
    expect(second).toEqual({ storeId: LOCAL_STORE_ID });
    expect(
      JSON.parse(
        readFileSync(join(mirrorDir, BACKUP_IDENTITY_FILENAME), "utf8"),
      ),
    ).toEqual({ storeId: LOCAL_STORE_ID });
    expect(existsSync(join(mirrorDir, "issues", BACKUP_IDENTITY_FILENAME))).toBe(
      false,
    );
  });

  it("raises when an existing identity file is malformed", () => {
    const mirrorDir = tempMirrorDir();
    writeFileSync(join(mirrorDir, BACKUP_IDENTITY_FILENAME), "{");
    expect(() => ensureBackupIdentity(mirrorDir)).toThrow(
      /not valid JSON/,
    );
  });
});

describe("parseBackupIdentity", () => {
  it("requires a non-empty storeId", () => {
    expect(() => parseBackupIdentity("{}")).toThrow(/storeId/);
    expect(() => parseBackupIdentity('{"storeId":""}')).toThrow(/storeId/);
  });
});

describe("pushMirrorIfAllowed", () => {
  it("pushes a first snapshot to an empty remote without fetching", async () => {
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return "";
      },
      fetchOrigin: async () => {
        calls.push("fetchOrigin");
      },
      showFileAtRef: async () => {
        calls.push("showFileAtRef");
        return '{"storeId":"other"}\n';
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).resolves.toBe("pushed");

    expect(calls).toEqual([
      "ensureOriginRemote",
      "lsRemoteOrigin",
      "pushMainToOrigin",
    ]);
    expect(getCurrentBackupProblem()).toBeNull();
  });

  it("pushes when the remote identity matches", async () => {
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return `${LOCAL_STORE_ID}	refs/heads/main\n`;
      },
      showFileAtRef: async (_workspace, spec) => {
        calls.push("showFileAtRef");
        expect(spec).toBe(`origin/main:${BACKUP_IDENTITY_FILENAME}`);
        return JSON.stringify({ storeId: LOCAL_STORE_ID });
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).resolves.toBe("pushed");

    expect(calls).toEqual([
      "ensureOriginRemote",
      "lsRemoteOrigin",
      "fetchOrigin",
      "showFileAtRef",
      "pushMainToOrigin",
    ]);
    expect(getCurrentBackupProblem()).toBeNull();
  });

  it("refuses a remote whose storeId differs and does not push", async () => {
    const otherId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return `${otherId}	refs/heads/main\n`;
      },
      showFileAtRef: async () => {
        calls.push("showFileAtRef");
        return JSON.stringify({ storeId: otherId });
      },
      pushMainToOrigin: async () => {
        calls.push("pushMainToOrigin");
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).resolves.toBe("refused");

    expect(calls).toEqual([
      "ensureOriginRemote",
      "lsRemoteOrigin",
      "fetchOrigin",
      "showFileAtRef",
    ]);
    expect(calls).not.toContain("pushMainToOrigin");
    expect(getCurrentBackupProblem()).toEqual({
      kind: "diverged",
      localStoreId: LOCAL_STORE_ID,
      remoteStoreId: otherId,
      message: `Remote store identity differs from this machine (local ${LOCAL_STORE_ID}, remote ${otherId})`,
    });
  });

  it("refuses a remote that has history but no backup identity", async () => {
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return "abc\trefs/heads/main\n";
      },
      showFileAtRef: async () => {
        calls.push("showFileAtRef");
        throw new Error("path not in tree");
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).resolves.toBe("refused");

    expect(calls).not.toContain("pushMainToOrigin");
    expect(getCurrentBackupProblem()).toEqual({
      kind: "diverged",
      localStoreId: LOCAL_STORE_ID,
      remoteStoreId: null,
      message: "Remote has history but is not this store's mirror",
    });
  });

  it("refuses a remote whose identity file is malformed", async () => {
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return "abc\trefs/heads/main\n";
      },
      showFileAtRef: async () => {
        calls.push("showFileAtRef");
        return "{";
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).resolves.toBe("refused");

    expect(calls).not.toContain("pushMainToOrigin");
    expect(getCurrentBackupProblem()).toMatchObject({
      kind: "diverged",
      remoteStoreId: null,
    });
  });

  it("lets a fetch failure propagate so it is not recorded as divergence", async () => {
    const { git, calls } = stubGit({
      lsRemoteOrigin: async () => {
        calls.push("lsRemoteOrigin");
        return "abc\trefs/heads/main\n";
      },
      fetchOrigin: async () => {
        calls.push("fetchOrigin");
        throw new Error("Could not read from remote repository");
      },
    });

    await expect(
      pushMirrorIfAllowed("/mirror", REMOTE_URL, LOCAL_STORE_ID, git),
    ).rejects.toThrow(/Could not read from remote repository/);
    expect(calls).not.toContain("pushMainToOrigin");
    expect(getCurrentBackupProblem()).toBeNull();
  });
});
