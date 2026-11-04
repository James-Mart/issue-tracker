import type { Command } from "commander";
import { linkedRootsForOutline } from "@/features/issues/lib/outline-links";
import { assertKind } from "./cli-kind.js";
import { readCliFileArg } from "./cli-io.js";
import {
  outlineVersionDiff,
  parseOutlineVersion,
} from "./server/services/outline-body.js";
import {
  discardOutlineDraft,
  publishOutlineDraft,
  setOutlineDraft,
  type OutlineDraftUpdate,
} from "./server/services/outline-draft.js";
import { agentSessions } from "./server/services/agent-sessions.js";
import { list } from "./server/services/issues.js";

type Run = (action: () => unknown) => Promise<void>;

export function registerOutlineCommands(kindCmd: Command, run: Run): void {
  kindCmd
    .command("versions")
    .argument("<id>", "outline id")
    .description("list saved body versions, oldest first")
    .action((id: string) =>
      run(() => {
        const outline = assertKind("outline", id);
        for (let version = 1; version <= outline.bodyVersion; version += 1) {
          process.stdout.write(`${version}\n`);
        }
      }),
    );

  kindCmd
    .command("diff")
    .argument("<id>", "outline id")
    .argument("<from>", "body version to diff from")
    .argument("<to>", "body version to diff to")
    .description("unified diff of two saved outline bodies")
    .action((id: string, fromRaw: string, toRaw: string) =>
      run(() => {
        const outline = assertKind("outline", id);
        const from = parseOutlineVersion(fromRaw);
        const to = parseOutlineVersion(toRaw);
        process.stdout.write(
          outlineVersionDiff(id, outline.bodyVersion, from, to),
        );
      }),
    );

  kindCmd
    .command("open-roots")
    .argument("<id>", "outline id")
    .description(
      "list open root Epics and project-level Stories stamped with this outline as `<rootId> <version>` lines",
    )
    .action((id: string) =>
      run(() => {
        assertKind("outline", id);
        const { issues, derived } = list();
        for (const root of linkedRootsForOutline(issues, derived, id, false)) {
          if (root.open) process.stdout.write(`${root.id} ${root.version}\n`);
        }
      }),
    );

  const draft = kindCmd
    .command("draft")
    .description("the outline's one pending body, which is not a version until update");

  draft
    .command("set")
    .argument("<id>", "outline id")
    .argument("<file>", "draft body (use - for stdin)")
    .description("replace the pending draft without adding a version")
    .action((id: string, file: string) =>
      run(() => setOutlineDraft(id, readCliFileArg(file))),
    );

  draft
    .command("update")
    .argument("<id>", "outline id")
    .option("--target-story <id>", "story that receives new tasks")
    .option(
      "--covered-by <taskIds...>",
      "tasks this flow already created (spaces or commas)",
    )
    .option(
      "--source-idea <id>",
      "idea recorded as sourceIdea on tasks appended to the target story",
    )
    .description(
      "save the pending draft as the next version and start reconciliation",
    )
    .action((id: string, opts: OutlineDraftUpdate) =>
      run(async () => {
        const published = await publishOutlineDraft(
          id,
          {
            targetStory: opts.targetStory,
            coveredBy: coveredByIds(opts.coveredBy),
            sourceIdea: opts.sourceIdea,
          },
          agentSessions,
        );
        process.stdout.write(`${published.version}\n`);
      }),
    );

  draft
    .command("discard")
    .argument("<id>", "outline id")
    .description("drop the pending draft")
    .action((id: string) => run(() => discardOutlineDraft(id)));
}

function coveredByIds(raw: string[] | undefined): string[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const ids = raw.flatMap((part) =>
    part
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return ids.length > 0 ? ids : undefined;
}
