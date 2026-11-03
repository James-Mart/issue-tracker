/** Installed absolute directory for this plugin. */
export const PLUGIN_DIR = "/root/.cursor/plugins/local/issue-tracker";

/** Absolute path to a skill's SKILL.md under the plugin install. */
export function skillPath(skill: string): string {
  return PLUGIN_DIR + "/skills/" + skill + "/SKILL.md";
}

/** Absolute path to a shared agent body under the plugin install. */
export function agentBodyPath(name: string): string {
  return PLUGIN_DIR + "/agents/" + name + ".md";
}
