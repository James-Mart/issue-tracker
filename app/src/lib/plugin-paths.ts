/** Installed absolute directory for this plugin. */
export const PLUGIN_DIR = "/root/.cursor/plugins/local/issue-tracker";

/** Absolute path to a skill's SKILL.md under the plugin install. */
export function skillPath(skill: string): string {
  return PLUGIN_DIR + "/skills/" + skill + "/SKILL.md";
}
