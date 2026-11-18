import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readCapabilityCatalog } from "./capability-catalog.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeRole(agentsDir: string, roleId: string, description: string): void {
  writeFileSync(
    join(agentsDir, `${roleId}.md`),
    `---\nname: ${roleId}\ndescription: ${description}\nmodel: cursor-grok-4.7\n---\n\nBody\n`,
  );
}

describe("readCapabilityCatalog", () => {
  it("titles the shared default, the read-only profile, and drops the role prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "capability-catalog-"));
    dirs.push(root);
    const agentsDir = join(root, "agents");
    mkdirSync(agentsDir);
    mkdirSync(join(root, "skills", "issue-tracker"), { recursive: true });
    writeFileSync(join(root, "skills", "issue-tracker", "SKILL.md"), "# skill\n");
    writeFileSync(join(agentsDir, "_issue-tracker-cli.md"), "# cli\n");
    writeRole(agentsDir, "issue-tracker-implementor-grok", "Implements one Task.");
    writeRole(agentsDir, "issue-tracker-research", "Answers one question.");
    writeRole(agentsDir, "custom-role", "A role outside the shared prefix.");
    writeFileSync(join(agentsDir, "_not-a-role.md"), "# skip\n");
    writeFileSync(
      join(agentsDir, "capabilities.json"),
      JSON.stringify({
        default: {
          settingSources: [],
          inject: [
            { kind: "skill", path: "../skills/issue-tracker/SKILL.md" },
            { kind: "rule", path: "_issue-tracker-cli.md" },
          ],
          customTools: ["delegate", "agent_stack_start"],
          builtins: ["read", "edit"],
          mcp: ["playwright"],
        },
        profiles: {
          "read-only": {
            settingSources: [],
            inject: [{ kind: "rule", path: "_issue-tracker-cli.md" }],
            customTools: ["issue_read", "git_read"],
            builtins: ["read", "grep"],
            mcp: [],
          },
          audit: {
            settingSources: ["project"],
            inject: [],
            customTools: ["git_read"],
            builtins: ["read"],
            mcp: [],
          },
        },
        roles: {
          "issue-tracker-research": { profile: "read-only" },
          "custom-role": { profile: "audit" },
        },
      }),
    );

    const catalog = readCapabilityCatalog(agentsDir);

    expect(catalog.sharedDefault.title).toBe("Shared default");
    expect(catalog.sharedDefault.contract.inject).toEqual([
      { kind: "skill", path: "skills/issue-tracker/SKILL.md" },
      { kind: "rule", path: "agents/_issue-tracker-cli.md" },
    ]);
    expect(catalog.sharedDefault.contract.customTools).toEqual([
      "delegate",
      "agent_stack_start",
    ]);
    expect(catalog.sharedDefault.contract.mcp).toEqual(["playwright"]);
    expect(catalog.profiles.map((profile) => profile.title)).toEqual([
      "Read-only profile",
      "audit",
    ]);
    expect(catalog.roles.map((role) => role.title)).toEqual([
      "custom-role",
      "implementor-grok",
      "research",
    ]);
    expect(catalog.roles).toHaveLength(3);

    const implementor = catalog.roles.find(
      (role) => role.roleId === "issue-tracker-implementor-grok",
    );
    expect(implementor?.profileTitle).toBe("Shared default");
    expect(implementor?.profileId).toBeUndefined();
    expect(implementor?.description).toBe("Implements one Task.");
    expect(implementor?.contract.inject.at(-1)).toEqual({
      kind: "role",
      path: "agents/issue-tracker-implementor-grok.md",
    });
    expect(implementor?.contract.inject.filter((row) => row.kind === "role")).toHaveLength(1);
    expect(implementor?.contract.customTools).toEqual([
      "delegate",
      "agent_stack_start",
    ]);

    const research = catalog.roles.find(
      (role) => role.roleId === "issue-tracker-research",
    );
    expect(research?.profileId).toBe("read-only");
    expect(research?.profileTitle).toBe("Read-only profile");
    expect(research?.contract.customTools).toEqual(["issue_read", "git_read"]);
    expect(research?.contract.mcp).toEqual([]);
    expect(research?.contract.inject).toEqual([
      { kind: "rule", path: "agents/_issue-tracker-cli.md" },
      { kind: "role", path: "agents/issue-tracker-research.md" },
    ]);

    const audit = catalog.roles.find((role) => role.roleId === "custom-role");
    expect(audit?.profileTitle).toBe("audit");
    expect(audit?.title).toBe("custom-role");
  });
});
