"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");

function absolutizeString(value, base) {
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

/** Content globs are relative to the tailwind config file, not Storybook's cwd. */
function absolutizeTailwindContent(content, base) {
  if (typeof content === "string") return absolutizeString(content, base);
  if (Array.isArray(content)) {
    return content.map((item) =>
      typeof item === "string" ? absolutizeString(item, base) : item,
    );
  }
  if (content && typeof content === "object") {
    const next = { ...content };
    if (Array.isArray(next.files)) {
      next.files = next.files.map((item) =>
        typeof item === "string" ? absolutizeString(item, base) : item,
      );
    }
    return next;
  }
  return content;
}

function unwrapDefault(loaded) {
  if (loaded && typeof loaded === "object" && loaded.__esModule && "default" in loaded) {
    return loaded.default;
  }
  return loaded;
}

function loadConfigModule(req, configPath) {
  try {
    return unwrapDefault(req(configPath));
  } catch (requireErr) {
    let jiti;
    try {
      jiti = req("jiti");
    } catch {
      throw requireErr;
    }
    return jiti(configPath, { interopDefault: true })(configPath);
  }
}

function configObjectFromFile(req, configPath) {
  const loaded = loadConfigModule(req, configPath);
  if (!loaded || typeof loaded !== "object") return loaded;
  if (!Object.hasOwn(loaded, "content")) return loaded;
  return {
    ...loaded,
    content: absolutizeTailwindContent(loaded.content, path.dirname(configPath)),
  };
}

function isEmptyObject(arg) {
  return (
    typeof arg === "object" &&
    arg !== null &&
    !Array.isArray(arg) &&
    Object.keys(arg).length === 0
  );
}

/**
 * `tailwindcss()` and `tailwindcss({})` look for `tailwind.config.js` in
 * `process.cwd()`. Storybook's cwd is the plugin app, so the argument becomes
 * the target's config object with content paths made absolute.
 */
function rewriteTailwindArgument(arg, ctx) {
  const { nearest, configDir, req } = ctx;
  if (typeof arg === "string") {
    const configPath = path.isAbsolute(arg) ? arg : path.resolve(configDir, arg);
    return configObjectFromFile(req, configPath);
  }
  if (arg && typeof arg === "object" && !Array.isArray(arg) && typeof arg.config === "string") {
    const configPath = path.isAbsolute(arg.config)
      ? arg.config
      : path.resolve(configDir, arg.config);
    const { config: _config, ...rest } = arg;
    return { ...configObjectFromFile(req, configPath), ...rest };
  }
  if (arg == null || isEmptyObject(arg)) {
    if (nearest == null) return { content: [] };
    return configObjectFromFile(req, nearest);
  }
  if (arg && typeof arg === "object" && Object.hasOwn(arg, "content")) {
    return { ...arg, content: absolutizeTailwindContent(arg.content, configDir) };
  }
  return arg;
}

function createWrappedTailwind({ realEntry, nearest, configDir }) {
  const req = createRequire(realEntry);
  const tailwind = req(realEntry);
  function wrapped(arg) {
    return tailwind(rewriteTailwindArgument(arg, { nearest, configDir, req }));
  }
  wrapped.postcss = true;
  return wrapped;
}

module.exports = { createWrappedTailwind };
