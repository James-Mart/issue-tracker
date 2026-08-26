import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig, type AliasOptions } from "vite";
import { loadHarnessConfig } from "./harness-config.js";
import {
  SMOKE_STORY_GLOB,
  buildHarnessStorybookOptions,
} from "./storybook-config.js";

const harnessConfigPath = process.env.MOCKUP_HARNESS_CONFIG;

function mergeAliasOptions(
  existing: AliasOptions | undefined,
  aliases: Record<string, string>,
): AliasOptions {
  if (Array.isArray(existing)) {
    return [
      ...existing,
      ...Object.entries(aliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
    ];
  }
  return { ...existing, ...aliases };
}

function createConfig(): StorybookConfig {
  if (!harnessConfigPath) {
    // Self-test mode: without MOCKUP_HARNESS_CONFIG the harness only serves
    // the committed smoke story so CI and local dev can verify Storybook itself.
    return {
      stories: [SMOKE_STORY_GLOB],
      framework: "@storybook/react-vite",
    };
  }

  const harness = loadHarnessConfig(harnessConfigPath);
  const options = buildHarnessStorybookOptions(harness);

  return {
    stories: options.stories,
    framework: options.viteConfigPath
      ? {
          name: "@storybook/react-vite",
          options: {
            builder: {
              viteConfigPath: options.viteConfigPath,
            },
          },
        }
      : "@storybook/react-vite",
    async viteFinal(viteConfig) {
      return mergeConfig(viteConfig, {
        resolve: {
          alias: mergeAliasOptions(viteConfig.resolve?.alias, options.aliases),
        },
        server: {
          fs: {
            allow: [
              ...(viteConfig.server?.fs?.allow ?? []),
              ...options.fsAllow,
            ],
          },
        },
      });
    },
  };
}

const config: StorybookConfig = createConfig();

export default config;
