import type { Command } from "commander";
import { linkedRootsForOutline } from "@/features/issues/lib/outline-links";
import { assertKind } from "./cli-kind.js";
import { readCliFileArg } from "./cli-io.js";
import {
  outlineVersionDiff,
  parseOutlineVersion,
} from "./server/services/outline-body.js";
import {
  formatOutlineCheckVerdict,
  setOutlineDraft,
  settleOutlineDraft,
} from "./server/services/review-outline-check.js";
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
    .description("the outline's one pending body, owned by a review's outline check");

  draft
    .command("set")
    .argument("<id>", "outline id")
    .argument("<file>", "draft body (use - for stdin)")
    .description("open the outline-check draft, or replace its text")
    .action((id: string, file: string) =>
      run(() => setOutlineDraft(id, readCliFileArg(file))),
    );

  for (const [verdict, name, description] of [
    ["yes", "approve", "settle the outline-check gate as yes"],
    ["not-now", "discard", "settle the outline-check gate as not-now"],
  ] as const) {
    draft
      .command(name)
      .argument("<id>", "outline id")
      .description(description)
      .action((id: string) =>
        run(async () => {
          const check = await settleOutlineDraft(id, verdict);
          process.stdout.write(`${formatOutlineCheckVerdict(check)}\n`);
        }),
      );
  }
}
