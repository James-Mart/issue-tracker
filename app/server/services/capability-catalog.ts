import { dirname, relative } from "path";
import {
  defaultAgentsDir,
  listSpawnableRoleIds,
  loadRoleDescription,
} from "./role-bodies.js";
import {
  readSpawnContracts,
  type CapabilityDocumentSlice,
} from "./role-runtime.js";

const ROLE_TITLE_PREFIX = "issue-tracker-";

export interface CatalogInjectRow {
  kind: "skill" | "rule" | "role";
  /** Plugin-relative path of the injected file. */
  path: string;
}

export interface CatalogContract {
  settingSources: string[];
  inject: CatalogInjectRow[];
  customTools: string[];
  builtins: string[];
  mcp: string[];
}

export interface CatalogEntry {
  id: string;
  kind: "default" | "profile" | "role";
  title: string;
  /** Full spawnable role id. Present on role entries. */
  roleId?: string;
  /** Manifest profile id. Absent when the role resolves the shared default. */
  profileId?: string;
  /** Profile the role uses, titled for the catalog. Present on role entries. */
  profileTitle?: string;
  description?: string;
  contract: CatalogContract;
}

export interface CapabilityCatalog {
  sharedDefault: CatalogEntry;
  profiles: CatalogEntry[];
  roles: CatalogEntry[];
}

export function roleCatalogTitle(roleId: string): string {
  return roleId.startsWith(ROLE_TITLE_PREFIX)
    ? roleId.slice(ROLE_TITLE_PREFIX.length)
    : roleId;
}

export function profileCatalogTitle(profileId: string): string {
  if (profileId === "read-only") return "Read-only profile";
  return profileId;
}

function displayPath(agentsDir: string, absolutePath: string): string {
  return relative(dirname(agentsDir), absolutePath).split("\\").join("/");
}

function catalogContract(
  agentsDir: string,
  slice: CapabilityDocumentSlice,
): CatalogContract {
  return {
    settingSources: slice.settingSources,
    inject: slice.inject.map((row) => ({
      kind: row.kind,
      path: displayPath(agentsDir, row.path),
    })),
    customTools: slice.customTools,
    builtins: slice.builtins,
    mcp: slice.mcp,
  };
}

/** Read-only catalog of the capability document and every spawnable role. */
export function readCapabilityCatalog(
  agentsDir: string = defaultAgentsDir(),
): CapabilityCatalog {
  const roleIds = listSpawnableRoleIds(agentsDir);
  const document = readSpawnContracts(roleIds, agentsDir);
  return {
    sharedDefault: {
      id: "default",
      kind: "default",
      title: "Shared default",
      contract: catalogContract(agentsDir, document.sharedDefault),
    },
    profiles: document.profiles.map((profile) => ({
      id: profile.id,
      kind: "profile" as const,
      title: profileCatalogTitle(profile.id),
      contract: catalogContract(agentsDir, profile.slice),
    })),
    roles: document.roles.map((role) => {
      const description = loadRoleDescription(role.id, agentsDir);
      return {
        id: role.id,
        kind: "role" as const,
        title: roleCatalogTitle(role.id),
        roleId: role.id,
        ...(role.profileId ? { profileId: role.profileId } : {}),
        profileTitle: role.profileId
          ? profileCatalogTitle(role.profileId)
          : "Shared default",
        ...(description ? { description } : {}),
        contract: catalogContract(agentsDir, role.slice),
      };
    }),
  };
}
