import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";
import {
  DEFAULT_BASE_URL,
  resolveDefaultBaseUrl,
} from "./scripts/capture-screenshots.js";

export function usesAgentStackEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AGENT_STACK_BASE_URL?.trim());
}

export function buildPlaywrightConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlaywrightTestConfig {
  const baseURL = resolveDefaultBaseUrl(env);

  return {
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!env.CI,
    retries: env.CI ? 2 : 0,
    workers: env.CI ? 1 : undefined,
    reporter: "list",
    expect: {
      toHaveScreenshot: {
        animations: "disabled",
        caret: "hide",
      },
    },
    use: {
      baseURL,
      trace: "retain-on-failure",
    },
    projects: [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
    ],
    ...(usesAgentStackEnv(env)
      ? {}
      : {
          webServer: {
            command: "npm run dev",
            url: DEFAULT_BASE_URL,
            reuseExistingServer: !env.CI,
          },
        }),
  };
}

export default defineConfig(buildPlaywrightConfig());
