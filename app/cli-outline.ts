import type { Command } from "commander";
import { linkedRootsForOutline } from "@/features/issues/lib/outline-links";
import { assertKind } from "./cli-kind.js";
import {
  outlineVersionDiff,
  parseOutlineVersion,
} from "./server/services/outline-body.js";
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
}
