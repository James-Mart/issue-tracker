import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentDefinitions } from "./agent-definitions.js";

let agentsDir: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), "issue-agent-definitions-"));
  mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
  rmSync(agentsDir, { recursive: true, force: true });
});

describe("loadAgentDefinitions", () => {
  it("loads a pinned agent with description and prompt from frontmatter/body", () => {
    writeAgent(
      "pinned-agent.md",
      `---
name: pinned-agent
model: composer-2.5
description: >-
  Pins a model for nested spawns.
readonly: false
---

You are the pinned agent.

Follow the checklist.`,
    );

    expect(loadAgentDefinitions(agentsDir)).toEqual({
      "pinned-agent": {
        description: "Pins a model for nested spawns.",
        model: { id: "composer-2.5" },
        prompt: "You are the pinned agent.\n\nFollow the checklist.",
      },
    });
  });

  it("omits model when the agent is pinned inherit", () => {
    writeAgent(
      "inherit-agent.md",
      `---
name: inherit-agent
model: inherit
description: Inherits the parent model.
---

Inherit body prompt.`,
    );

    expect(loadAgentDefinitions(agentsDir)).toEqual({
      "inherit-agent": {
        description: "Inherits the parent model.",
        prompt: "Inherit body prompt.",
      },
    });
  });

  it("skips underscore-prefixed shared includes", () => {
    writeAgent(
      "_shared-include.md",
      `---
name: shared-include
model: composer-2.5
description: Shared include, not spawnable.
---

Include body.`,
    );
    writeAgent(
      "spawnable.md",
      `---
name: spawnable
model: composer-2.5
description: Spawnable agent.
---

Spawnable body.`,
    );

    expect(loadAgentDefinitions(agentsDir)).toEqual({
      spawnable: {
        description: "Spawnable agent.",
        model: { id: "composer-2.5" },
        prompt: "Spawnable body.",
      },
    });
  });

  it("skips malformed files and files without frontmatter or name", () => {
    writeAgent("no-frontmatter.md", "# Just markdown\n\nNo YAML block.");
    writeAgent(
      "missing-name.md",
      `---
model: composer-2.5
description: No name field.
---

Body without a name.`,
    );
    writeAgent(
      "broken-frontmatter.md",
      `---
name: [unclosed
description: broken yaml
---

Never parsed.`,
    );
    writeAgent(
      "valid.md",
      `---
name: valid
model: claude-opus-5-thinking-high
description: Valid agent.
---

Valid body.`,
    );

    expect(loadAgentDefinitions(agentsDir)).toEqual({
      valid: {
        description: "Valid agent.",
        model: { id: "claude-opus-5-thinking-high" },
        prompt: "Valid body.",
      },
    });
  });
});
