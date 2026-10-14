// Playwright MCP loads this with require() and calls exports.default({ page }).
// The guard re-reads the live stack on each navigation.

const { join } = require("node:path");
const { register } = require("tsx/cjs/api");

process.env.TSX_TSCONFIG_PATH = join(__dirname, "../../tsconfig.json");
register();

const { installBrowserOriginGuard } = require("./browser-origin-allowlist.ts");

exports.default = async function browserOriginInitPage({ page }) {
  await installBrowserOriginGuard(page);
};
