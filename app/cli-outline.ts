import type { Command } from "commander";
import { assertKind } from "./cli-kind.js";
import {
  diffOutlineBodies,
  parseOutlineVersion,
  readOutlineBody,
} from "./server/services/outline-body.js";

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
        const fromBody = readOutlineBody(id, from, outline.bodyVersion);
        const toBody = readOutlineBody(id, to, outline.bodyVersion);
        process.stdout.write(diffOutlineBodies(from, fromBody, to, toBody));
      }),
    );
}
