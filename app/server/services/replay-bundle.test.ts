import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packReplayBundle } from "./replay-bundle.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it("rejects an alias inside the replay tree outside the direction folder", () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-replay-bundle-"));
  const scratch = join(root, "scratch");
  mkdirSync(join(scratch, "a"), { recursive: true });
  mkdirSync(join(scratch, "b", "src"), { recursive: true });
  writeFileSync(
    join(scratch, "a", "a.stories.tsx"),
    `export default { title: "A/Screen" };\nexport const Default = {};\n`,
  );
  writeFileSync(join(scratch, "a", "app.css"), ".a{}\n");
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "mockup-sandbox" }));
  writeFileSync(
    join(scratch, "harness.json"),
    JSON.stringify({
      targetRoot: join(root, "target-src"),
      cssEntries: [join(scratch, "a", "app.css")],
      aliases: { "@other": join(scratch, "b", "src") },
      storiesGlobs: [join(scratch, "a", "**/*.stories.tsx")],
    }),
  );
  expect(() => packReplayBundle(scratch, "a")).toThrow(/aliases\.@other/);
});
