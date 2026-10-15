import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessConfig } from "./harness-config.js";
import { PLUGIN_APP_DIR } from "./harness-paths.js";
import { harnessResolvePlugin } from "./harness-resolve.js";
import { buildHarnessStorybookOptions } from "./storybook-config.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReactCopy(modulesDir: string, copyId: string): void {
  const reactDir = path.join(modulesDir, "react");
  const reactDomDir = path.join(modulesDir, "react-dom");
  writeJson(path.join(reactDir, "package.json"), {
    name: "react",
    version: "0.0.0",
    type: "module",
    main: "index.js",
  });
  writeFileSync(
    path.join(reactDir, "index.js"),
    `export const copyId = ${JSON.stringify(copyId)};
export function useState(initial) { return [initial, () => {}]; }
export function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() };
}
`,
  );
  writeFileSync(
    path.join(reactDir, "jsx-runtime.js"),
    `export function jsx(type, props) {
  const { children, ...rest } = props ?? {};
  return { type, props: rest, children: children === undefined ? [] : [children].flat() };
}
export const jsxs = jsx;
`,
  );
  writeJson(path.join(reactDomDir, "package.json"), {
    name: "react-dom",
    version: "0.0.0",
    type: "module",
    main: "index.js",
  });
  writeFileSync(
    path.join(reactDomDir, "server.js"),
    `import { copyId } from "react";
function renderNode(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderNode).join("");
  if (typeof node.type === "function") return renderNode(node.type(node.props));
  const children = node.children ?? [];
  return "<" + node.type + ">" + children.map(renderNode).join("") + "</" + node.type + ">";
}
export function renderToString(node) { return renderNode(node); }
export { copyId };
`,
  );
}

function layout(): {
  root: string;
  target: string;
  aliasDir: string;
  scratch: string;
  css: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "issue-tracker-harness-react-"));
  root = dir;
  const target = path.join(dir, "target");
  const aliasDir = path.join(dir, "alias-pkg", "src");
  const scratch = path.join(dir, "scratch");
  const css = path.join(target, "app.css");
  mkdirSync(aliasDir, { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(css, "");
  return { root: dir, target, aliasDir, scratch, css };
}

describe("React aliases", () => {
  it("renders a story with the renderer's React and the target's React as one copy", async () => {
    const dirs = layout();
    writeReactCopy(path.join(dirs.root, "alias-pkg", "node_modules"), "alias-react");
    writeReactCopy(path.join(dirs.target, "node_modules"), "target-react");
    const widget = path.join(dirs.target, "Widget.js");
    writeFileSync(
      widget,
      `import { copyId, createElement, useState } from "react";
export function Widget() {
  const [label] = useState("story-ready");
  return createElement("span", null, label + ":" + copyId);
}
`,
    );
    const story = path.join(dirs.scratch, "demo", "widget.stories.js");
    mkdirSync(path.dirname(story), { recursive: true });
    writeFileSync(
      story,
      `import { createElement } from "react";
import { Widget } from ${JSON.stringify(widget)};
export default { title: "Demo/Widget" };
export function Default() {
  return createElement(Widget);
}
`,
    );

    const config: HarnessConfig = {
      targetRoot: dirs.target,
      cssEntries: [dirs.css],
      aliases: { "@ui": dirs.aliasDir },
      storiesGlobs: [path.join(dirs.scratch, "**/*.stories.js")],
    };
    const options = buildHarnessStorybookOptions(config, dirs.scratch);
    expect(options.reactAliases.react).toBe(
      path.join(dirs.root, "alias-pkg", "node_modules", "react"),
    );

    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      root: dirs.scratch,
      appType: "custom",
      server: {
        middlewareMode: true,
        fs: { strict: true, allow: options.fsAllow },
      },
      ssr: { noExternal: true },
      optimizeDeps: { exclude: ["react", "react-dom"] },
      plugins: [harnessResolvePlugin(options.resolveRoots)],
      resolve: { alias: { ...options.aliases, ...options.reactAliases } },
    });
    try {
      const html = await renderedStory(server, story);
      const fromPreview = await resolvedReact(
        server,
        path.join(PLUGIN_APP_DIR, ".storybook", "preview.ts"),
      );
      const fromTarget = await resolvedReact(server, widget);
      const react = (await server.ssrLoadModule("react")) as { copyId: string };
      expect(html).toBe("<span>story-ready:alias-react</span>");
      expect(react.copyId).toBe("alias-react");
      expect(fromPreview).toBe(fromTarget);
      expect(fromPreview).toContain(path.join("alias-pkg", "node_modules", "react"));
    } finally {
      await server.close();
    }
  });
});

async function resolvedReact(server: ViteDevServer, importer: string): Promise<string> {
  const resolved = await server.pluginContainer.resolveId("react", importer);
  if (!resolved) throw new Error(`react did not resolve from ${importer}`);
  return resolved.id.replace(/[?#].*$/, "");
}

async function renderedStory(server: ViteDevServer, story: string): Promise<string> {
  const loaded = (await server.ssrLoadModule(story)) as {
    Default: () => unknown;
  };
  const reactDom = (await server.ssrLoadModule("react-dom/server")) as {
    renderToString: (node: unknown) => string;
  };
  return reactDom.renderToString(loaded.Default());
}
