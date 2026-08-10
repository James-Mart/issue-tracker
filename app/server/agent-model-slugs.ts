import { FAKE_MODELS } from "./services/agent-sdk.fake.js";
import { IssueError } from "./services/errors.js";

/** Sync allowlist for agent model slug validation (schema + writes). */
let allowedSlugs = new Set(FAKE_MODELS.map((model) => model.id));

/** Test harness: skip live SDK sync in CLI subprocesses. */
export const SKIP_AGENT_MODEL_SLUG_SYNC_ENV = "ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC";

export function shouldSyncAgentModelSlugsFromSdk(): boolean {
  return process.env[SKIP_AGENT_MODEL_SLUG_SYNC_ENV] !== "1";
}

export function syncAgentModelSlugCatalog(
  models: readonly { id: string }[],
): void {
  configureAgentModelSlugs(models.map((model) => model.id));
}

export function configureAgentModelSlugs(slugs: readonly string[]): void {
  allowedSlugs = new Set(slugs);
}

export function resetAgentModelSlugsForTests(): void {
  allowedSlugs = new Set(FAKE_MODELS.map((model) => model.id));
}

export function isAllowedAgentModelSlug(slug: string): boolean {
  return allowedSlugs.has(slug);
}

export function assertAllowedAgentModelSlug(slug: string): void {
  if (!isAllowedAgentModelSlug(slug)) {
    throw new IssueError(
      "validation",
      `unknown agent model slug "${slug}"`,
    );
  }
}
