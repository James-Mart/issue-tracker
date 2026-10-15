import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createWrappedTailwind } = require("./harness-tailwind.cjs") as {
  createWrappedTailwind: (input: {
    realEntry: string;
    nearest: string | null;
    configDir: string;
  }) => (arg: unknown) => { postcssPlugin: string };
};

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("Tailwind", () => {
  it("applies the target's tailwind config instead of the plugin app's", async () => {
    root = mkdtempSync(path.join(tmpdir(), "issue-tracker-harness-tailwind-"));
    const configFile = path.join(root, "tailwind.config.js");
    writeFileSync(path.join(root, "marker.html"), `<div class="text-harness"></div>\n`);
    writeFileSync(
      configFile,
      `const path = require("node:path");
module.exports = {
  content: [path.join(__dirname, "marker.html")],
  corePlugins: { preflight: false },
  theme: { extend: { colors: { harness: "#123456" } } },
};
`,
    );
    const wrapped = createWrappedTailwind({
      realEntry: require.resolve("tailwindcss"),
      nearest: configFile,
      configDir: root,
    });
    const result = await postcss([wrapped({})]).process("@tailwind utilities;\n", {
      from: path.join(root, "app.css"),
    });
    expect(result.css).toContain("text-harness");
    expect(result.css).toContain("18 52 86");
  });
});
