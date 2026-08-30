// Pure role-family split shared by server and client — no imports, same contract
// as `shape.ts`.

/** Model tokens the harness suffixes role names with. */
export const MODEL_VARIANTS = [
  "composer",
  "grok",
  "opus",
  "sonnet",
  "fable",
] as const satisfies readonly string[];

export function roleFamily(role: string): { family: string; variant?: string } {
  for (const variant of MODEL_VARIANTS) {
    const suffix = `-${variant}`;
    if (role.endsWith(suffix)) {
      return { family: role.slice(0, -suffix.length), variant };
    }
  }
  return { family: role };
}

const ISSUE_TRACKER_PREFIX = "issue-tracker-";

const ROLE_FAMILY_TITLES: Record<string, string> = {
  "auto-plan-discriminator": "Discriminator",
  "model-discriminator": "Model discriminator",
  planner: "Planner",
  implementor: "Implementor",
  research: "Research",
  "mockup-author": "Mockup author",
  retro: "Retro",
  git: "Git",
  "story-review": "Story review",
  "code-quality-validator": "Code-quality validator",
  "design-conformance": "Design conformance",
  "plan-authoring-conformance": "Authoring conformance",
  "plan-dependency-order": "Dependency order",
  "plan-dry": "DRY",
  "plan-footprint": "Footprint",
  "plan-internal-consistency": "Internal consistency",
  "plan-no-ambiguity": "No-ambiguity",
};

/** Family id with the harness prefix removed; unmapped titles keep this string. */
export function strippedRoleFamily(family: string): string {
  return family.startsWith(ISSUE_TRACKER_PREFIX)
    ? family.slice(ISSUE_TRACKER_PREFIX.length)
    : family;
}

/** Seat title for a role family column. Variant stays on the beat, not here. */
export function roleFamilyTitle(family: string): string {
  const stripped = strippedRoleFamily(family);
  return ROLE_FAMILY_TITLES[stripped] ?? stripped;
}

/** Family id plus the beat caption (`Title` or `Title (variant)`). */
export function roleFamilyCaption(role: string): {
  family: string;
  variant?: string;
  caption: string;
} {
  const { family, variant } = roleFamily(role);
  const title = roleFamilyTitle(family);
  return {
    family,
    ...(variant !== undefined ? { variant } : {}),
    caption: variant !== undefined ? `${title} (${variant})` : title,
  };
}
