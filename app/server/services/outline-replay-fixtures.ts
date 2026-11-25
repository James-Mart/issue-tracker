import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Write `issues/<id>/issue.json` under `issuesDir`. */
export function writeStoredIssue(
  issuesDir: string,
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

/** A planning-scratch-shaped tree with one folder per direction. `root` is the scratch's target root. */
export function writeReplayScratch(root: string, scratch: string, directions: string[]): void {
  mkdirSync(scratch, { recursive: true });
  for (const directionId of directions) {
    mkdirSync(join(scratch, directionId, "parts"), { recursive: true });
    writeFileSync(
      join(scratch, directionId, `${directionId}.stories.tsx`),
      `export default { title: "${directionId}/Screen" };\nexport const Default = {};\n`,
    );
    writeFileSync(
      join(scratch, directionId, "parts", "fixture.ts"),
      `export const id = "${directionId}";\n`,
    );
  }
  const targetSrc = join(root, "target-src");
  mkdirSync(targetSrc, { recursive: true });
  writeFileSync(join(scratch, "vite.mockup.ts"), "export default {};\n");
  writeFileSync(
    join(scratch, "harness.json"),
    JSON.stringify({
      targetRoot: root,
      cssEntries: [],
      aliases: { "@scratch": targetSrc },
      storiesGlobs: directions.map((directionId) => join(scratch, directionId, "**/*.stories.tsx")),
      viteConfigPath: join(scratch, "vite.mockup.ts"),
    }),
  );
  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "mockup-sandbox", private: true, dependencies: {} }),
  );
}
