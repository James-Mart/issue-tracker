import { afterEach, describe, expect, it } from "vitest";
import {
  getCurrentBackupProblem,
  pushMirrorIfAllowed,
  resetCurrentBackupProblemForTests,
  type StoreBackupIdentityGit,
} from "./store-backup-identity.js";

afterEach(() => {
  resetCurrentBackupProblemForTests();
});

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

describe("pushMirrorIfAllowed", () => {
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
});
