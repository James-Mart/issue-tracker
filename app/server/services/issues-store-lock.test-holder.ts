// Child-process fixture for issues-store-lock.test.ts.
// argv: <issuesDir> <command> [...args]
//
// Commands:
//   create-idea <partOf> <title>  — create sibling; print JSON { id, order }
//   read-detail <id>              — print JSON { title, description, version }
//   partial-publish <id> <signal> <continue> <newTitle> <newDesc>
//                                 — under lock: write json, signal, wait, write desc

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const issuesDir = process.argv[2]!;
const command = process.argv[3]!;

process.env.ISSUES_DIR = issuesDir;

const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function waitForFile(path: string): void {
  while (!existsSync(path)) {
    Atomics.wait(waitBuffer, 0, 0, 10);
  }
}

async function main(): Promise<void> {
  if (command === "create-idea") {
    const partOf = process.argv[4]!;
    const title = process.argv[5]!;
    const { create } = await import("./issues.js");
    const created = await create({ kind: "idea", title, partOf });
    process.stdout.write(`${JSON.stringify({ id: created.id, order: created.order })}\n`);
    return;
  }

  if (command === "read-detail") {
    const id = process.argv[4]!;
    const { read, versionOf } = await import("./issues.js");
    const detail = read(id);
    const jsonText = readFileSync(join(issuesDir, id, "issue.json"), "utf8");
    process.stdout.write(
      `${JSON.stringify({
        title: detail.title,
        description: detail.description,
        version: detail.version,
        versionMatches: detail.version === versionOf(jsonText, detail.description),
      })}\n`,
    );
    return;
  }

  if (command === "partial-publish") {
    const id = process.argv[4]!;
    const signalPath = process.argv[5]!;
    const continuePath = process.argv[6]!;
    const newTitle = process.argv[7]!;
    const newDesc = process.argv[8]!;
    const { withIssuesStoreLock } = await import("./issues-store-lock.js");
    withIssuesStoreLock(() => {
      const jsonPath = join(issuesDir, id, "issue.json");
      const descPath = join(issuesDir, id, "description.md");
      const issue = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
      issue.title = newTitle;
      issue.updatedAt = new Date().toISOString();
      writeFileSync(jsonPath, `${JSON.stringify(issue, null, 2)}\n`);
      writeFileSync(signalPath, "json\n");
      waitForFile(continuePath);
      writeFileSync(descPath, newDesc);
    });
    return;
  }

  throw new Error(`unknown holder command: ${command}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
