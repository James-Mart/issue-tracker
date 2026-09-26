// Playwright MCP loads this with require() and calls exports.default({ page }).
// The guard re-reads the live stack on each navigation.

const { register } = require("tsx/cjs/api");

register();

const { installBrowserOriginGuard } = require("./browser-origin-allowlist.ts");

exports.default = async function browserOriginInitPage({ page }) {
  await installBrowserOriginGuard(page);
};
