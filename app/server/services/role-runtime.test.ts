import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./agent-definitions.js";
import { defaultAgentsDir } from "./role-bodies.js";

describe("capability manifest", () => {
  it("names the read-only profile for exactly the roles whose file is read-only", () => {
    const agentsDir = defaultAgentsDir();
    const manifest = JSON.parse(
      readFileSync(join(agentsDir, "capabilities.json"), "utf8"),
    ) as { roles: Record<string, { profile: string }> };
    const readOnlyRoles = readdirSync(agentsDir)
      .filter((entry) => entry.endsWith(".md") && !entry.startsWith("_"))
      .filter(
        (entry) =>
          splitFrontmatter(readFileSync(join(agentsDir, entry), "utf8"))
            ?.frontmatter.readonly === true,
      )
      .map((entry) => entry.slice(0, -".md".length));
    expect(readOnlyRoles.length).toBeGreaterThan(0);

    expect(manifest.roles).toEqual(
      Object.fromEntries(
        readOnlyRoles.map((role) => [role, { profile: "read-only" }]),
      ),
    );
  });
});
