import type { Command } from "commander";
import { coerceBoolean, coerceEnum, coerceJson } from "./cli-coerce.js";
import { readCliFileArg } from "./cli-io.js";
import {
  isClearableSetField,
  KIND_GET_FIELDS,
  KIND_SET_FIELDS,
  type SetFieldSpec,
} from "./server/kind-fields.js";
import { list, read, renameProjectLabel, update } from "./server/services/issues.js";
import { validateFullCommitSha } from "./server/services/commit-sha.js";
import {
  projectLabelSchema,
  type IssueDetail,
  type IssueKind,
  type IssuePatch,
  type ProjectLabel,
  type InspirationAppEntry,
  type SupportingDocKey,
  type SupportingDocRef,
  type SupportingDocs,
  formatZodError,
  inspirationAppEntrySchema,
  inspirationAppsSchema,
} from "./server/schemas.js";
import { isSupportingDocKey } from "./server/services/supporting-docs.js";

export type KindSetOptions = {
  clear?: boolean;
  file?: string;
  reason?: string;
  add?: string[];
  remove?: string[];
  rename?: string[];
  doc?: string;
  attachment?: string;
  /** Workspace-relative path for `supportingDocs` (`--workspace`). */
  workspace?: string;
};

function articleFor(kind: IssueKind): "a" | "an" {
  return kind === "epic" || kind === "idea" ? "an" : "a";
}

export function assertKind(expected: IssueKind, id: string): IssueDetail {
  const detail = read(id);
  if (detail.kind !== expected) {
    throw new Error(
      `"${id}" is ${articleFor(detail.kind)} ${detail.kind}, not ${articleFor(expected)} ${expected}`,
    );
  }
  return detail;
}

function resolveFileOrValue(
  value: string | undefined,
  file: string | undefined,
): string | undefined {
  if (file !== undefined) {
    if (value !== undefined) {
      throw new Error("--file cannot be combined with a positional value");
    }
    return readCliFileArg(file);
  }
  return value;
}

function countSetModes(
  value: string | undefined,
  opts: KindSetOptions,
): string[] {
  const modes: string[] = [];
  if (value !== undefined) modes.push("value");
  if (opts.file !== undefined) modes.push("--file");
  if (opts.clear) modes.push("--clear");
  if (opts.add !== undefined) modes.push("--add");
  if (opts.remove !== undefined) modes.push("--remove");
  if (opts.rename !== undefined) modes.push("--rename");
  return modes;
}

function formatModes(modes: string[]): string {
  return modes.join(", ");
}

function coerceArrayPatch(
  field: string,
  value: string | undefined,
  opts: KindSetOptions,
  current: string[] | undefined,
): IssuePatch {
  if (opts.rename !== undefined) {
    throw new Error("--rename is only valid for project labels");
  }
  const modes = countSetModes(value, opts);
  if (modes.length === 0) {
    throw new Error(
      `provide a JSON array value, --file, --add, --remove, or --clear for ${field}`,
    );
  }
  if (modes.length > 1) {
    throw new Error(
      `value, --file, --clear, --add, and --remove are mutually exclusive (got ${formatModes(modes)})`,
    );
  }
  if (opts.clear) {
    return { [field]: [] } as IssuePatch;
  }
  if (opts.add !== undefined) {
    if (!current) {
      throw new Error(`current value required for --add on ${field}`);
    }
    return {
      [field]: [
        ...current,
        ...opts.add.filter((id) => !current.includes(id)),
      ],
    } as IssuePatch;
  }
  if (opts.remove !== undefined) {
    if (!current) {
      throw new Error(`current value required for --remove on ${field}`);
    }
    return {
      [field]: current.filter((id) => !opts.remove!.includes(id)),
    } as IssuePatch;
  }

  const raw = resolveFileOrValue(value, opts.file);
  if (raw === undefined) {
    throw new Error(`provide a value for ${field}`);
  }
  const parsed = coerceJson(raw, field);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`invalid ${field}: expected a JSON array of strings`);
  }
  return { [field]: parsed } as IssuePatch;
}

function parseLabelObject(raw: string): ProjectLabel {
  const parsed = coerceJson(raw, "labels");
  const result = projectLabelSchema.safeParse(parsed);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "expected a label object";
    throw new Error(`invalid labels: ${message}`);
  }
  return result.data;
}

function parseInspirationAppObject(raw: string): InspirationAppEntry {
  const parsed = coerceJson(raw, "inspirationApps");
  const result = inspirationAppEntrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid inspirationApps: ${formatZodError(result.error, "expected an inspiration app object")}`,
    );
  }
  return result.data;
}

function parseInspirationAppsValue(raw: string): InspirationAppEntry[] {
  const parsed = coerceJson(raw, "inspirationApps");
  const result = inspirationAppsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid inspirationApps: ${formatZodError(result.error, "expected a JSON array")}`,
    );
  }
  return result.data;
}

/**
 * Resolve the JSON string for a catalog upsert from the mutually compatible
 * upsert inputs (`--add` object, `--file`/`-`, or positional value).
 * Returns undefined when no upsert input is present.
 */
function resolveCatalogUpsertRaw(
  value: string | undefined,
  opts: KindSetOptions,
): string | undefined {
  const hasAdd = opts.add !== undefined;
  const hasFile = opts.file !== undefined;
  const hasValue = value !== undefined;
  if (!hasAdd && !hasFile && !hasValue) return undefined;

  if (hasFile && hasValue) {
    throw new Error("--file cannot be combined with a positional value");
  }
  if (hasAdd && hasValue) {
    throw new Error(
      "value, --file, --clear, --add, --remove, and --rename are mutually exclusive (got value, --add)",
    );
  }
  if (hasAdd && hasFile && opts.add!.length > 0) {
    throw new Error("--add JSON cannot be combined with --file");
  }

  if (hasFile) {
    return readCliFileArg(opts.file!);
  }
  if (hasAdd) {
    if (opts.add!.length !== 1) {
      throw new Error("--add for project labels expects a single JSON object");
    }
    return opts.add![0];
  }
  return value;
}

export type LabelCatalogSetResult =
  | { action: "rename"; oldId: string; newId: string }
  | { action: "patch"; patch: IssuePatch };

/**
 * Resolve a `supportingDocs` patch from CLI flags.
 * Modes: clear all; clear one `--doc`; set one `--doc` with `--attachment` or
 * `--workspace`.
 */
export function resolveSupportingDocsSet(
  opts: KindSetOptions,
  current: SupportingDocs | undefined,
): IssuePatch {
  const doc = opts.doc;
  const hasAttachment = opts.attachment !== undefined;
  const hasWorkspace = opts.workspace !== undefined;
  const wantsClear = Boolean(opts.clear);

  if (opts.file !== undefined) {
    throw new Error("--file is not valid for supportingDocs");
  }
  if (opts.add !== undefined || opts.remove !== undefined) {
    throw new Error("--add and --remove are not valid for supportingDocs");
  }
  if (opts.rename !== undefined) {
    throw new Error("--rename is not valid for supportingDocs");
  }

  if (wantsClear) {
    if (hasAttachment || hasWorkspace) {
      throw new Error(
        "--clear cannot be combined with --attachment or --workspace",
      );
    }
    if (doc === undefined) {
      return { supportingDocs: null };
    }
    if (!isSupportingDocKey(doc)) {
      throw new Error(
        `unknown supportingDocs key "${doc}" (expected vision|codingStandards|designSystem)`,
      );
    }
    const next: SupportingDocs = { ...(current ?? {}) };
    delete next[doc];
    return {
      supportingDocs: Object.keys(next).length === 0 ? null : next,
    };
  }

  if (doc === undefined) {
    throw new Error(
      "provide --doc <vision|codingStandards|designSystem> (or --clear)",
    );
  }
  if (!isSupportingDocKey(doc)) {
    throw new Error(
      `unknown supportingDocs key "${doc}" (expected vision|codingStandards|designSystem)`,
    );
  }
  if (hasAttachment === hasWorkspace) {
    throw new Error(
      "provide exactly one of --attachment <name> or --workspace <path>",
    );
  }

  const key = doc as SupportingDocKey;
  const ref: SupportingDocRef = hasAttachment
    ? { type: "attachment", name: opts.attachment! }
    : { type: "workspace", path: opts.workspace! };
  const next: SupportingDocs = { ...(current ?? {}), [key]: ref };
  return { supportingDocs: next };
}

/**
 * Resolve an `inspirationApps` patch from CLI flags.
 * Modes: clear all; remove by `--remove <name>`; upsert one entry via
 * `--add` JSON `{name,url,description}`; or replace the full array via
 * positional value / `--file`.
 */
export function resolveInspirationAppsSet(
  value: string | undefined,
  opts: KindSetOptions,
  current: InspirationAppEntry[],
): IssuePatch {
  if (opts.doc !== undefined || opts.attachment !== undefined) {
    throw new Error(
      "--doc and --attachment are not valid for inspirationApps",
    );
  }
  if (opts.rename !== undefined) {
    throw new Error("--rename is not valid for inspirationApps");
  }

  const modes = countSetModes(value, opts);
  if (modes.length === 0) {
    throw new Error(
      "provide --add, --file, --remove, --clear, or a positional value for inspirationApps",
    );
  }
  if (modes.length > 1) {
    throw new Error(
      `value, --file, --clear, --add, and --remove are mutually exclusive (got ${formatModes(modes)})`,
    );
  }

  if (opts.clear) {
    return { inspirationApps: [] };
  }
  if (opts.remove !== undefined) {
    const removeSet = new Set(opts.remove);
    return {
      inspirationApps: current.filter((entry) => !removeSet.has(entry.name)),
    };
  }
  if (opts.add !== undefined) {
    if (opts.add.length !== 1) {
      throw new Error(
        "--add for inspirationApps expects a single JSON object with name, url, and description",
      );
    }
    const entry = parseInspirationAppObject(opts.add[0]);
    const next = [...current];
    const idx = next.findIndex((item) => item.name === entry.name);
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    const validated = inspirationAppsSchema.safeParse(next);
    if (!validated.success) {
      throw new Error(
        `invalid inspirationApps: ${formatZodError(validated.error, "invalid inspirationApps")}`,
      );
    }
    return { inspirationApps: validated.data };
  }

  const raw = resolveFileOrValue(value, opts.file);
  if (raw === undefined) {
    throw new Error(
      "provide a JSON array via --file or a positional value for inspirationApps",
    );
  }
  return { inspirationApps: parseInspirationAppsValue(raw) };
}

/**
 * Single entry for project `labels` set: exclusive modes are clear, remove,
 * rename, or upsert (composite of --add / --file / positional).
 */
export function resolveLabelCatalogSet(
  value: string | undefined,
  opts: KindSetOptions,
  current: ProjectLabel[],
): LabelCatalogSetResult {
  const wantsClear = Boolean(opts.clear);
  const wantsRemove = opts.remove !== undefined;
  const wantsRename = opts.rename !== undefined;
  const wantsUpsert =
    opts.add !== undefined || opts.file !== undefined || value !== undefined;

  const modes: string[] = [];
  if (wantsClear) modes.push("--clear");
  if (wantsRemove) modes.push("--remove");
  if (wantsRename) modes.push("--rename");
  if (wantsUpsert) modes.push("upsert");

  if (modes.length === 0) {
    throw new Error(
      "provide --add, --file, --remove, --rename, or --clear for labels",
    );
  }
  if (modes.length > 1) {
    throw new Error(
      `value, --file, --clear, --add, --remove, and --rename are mutually exclusive (got ${formatModes(modes)})`,
    );
  }

  if (wantsClear) {
    return { action: "patch", patch: { labels: [] } };
  }
  if (wantsRemove) {
    const removeSet = new Set(opts.remove!);
    return {
      action: "patch",
      patch: { labels: current.filter((label) => !removeSet.has(label.id)) },
    };
  }
  if (wantsRename) {
    if (opts.rename!.length !== 2) {
      throw new Error("--rename requires <oldId> <newId>");
    }
    return { action: "rename", oldId: opts.rename![0], newId: opts.rename![1] };
  }

  const raw = resolveCatalogUpsertRaw(value, opts);
  if (raw === undefined) {
    throw new Error(
      "provide a JSON object via --add, --file, or a positional value",
    );
  }
  const label = parseLabelObject(raw);
  const next = [...current];
  const idx = next.findIndex((entry) => entry.id === label.id);
  if (idx >= 0) next[idx] = label;
  else next.push(label);
  return { action: "patch", patch: { labels: next } };
}

export function coerceSetPatch(
  kind: IssueKind,
  field: string,
  value: string | undefined,
  opts: KindSetOptions,
  currentArray?: string[],
): IssuePatch {
  const tables = KIND_SET_FIELDS[kind] as Record<string, SetFieldSpec>;
  const spec = tables[field];
  if (!spec) {
    throw new Error(`unknown or unsettable field "${field}" for ${kind}`);
  }

  if (spec.type === "array") {
    return coerceArrayPatch(field, value, opts, currentArray);
  }

  if (spec.type === "labelCatalog") {
    throw new Error("project labels must be set via kindSet");
  }

  if (spec.type === "supportingDocs") {
    throw new Error("supportingDocs must be set via kindSet");
  }

  if (spec.type === "inspirationApps") {
    throw new Error("inspirationApps must be set via kindSet");
  }

  if (opts.add !== undefined || opts.remove !== undefined) {
    throw new Error("--add and --remove are only valid for array fields");
  }
  if (opts.rename !== undefined) {
    throw new Error("--rename is only valid for project labels");
  }
  if (
    opts.doc !== undefined ||
    opts.attachment !== undefined ||
    opts.workspace !== undefined
  ) {
    throw new Error(
      "--doc, --attachment, and --workspace are only valid for supportingDocs",
    );
  }

  const modes = countSetModes(value, opts);
  if (opts.clear) {
    if (modes.length > 1) {
      throw new Error(
        "--clear cannot be combined with a value, --file, --add, or --remove",
      );
    }
    if (spec.type === "needsAttention") {
      return { needsAttention: false, attentionReason: null };
    }
    if (!isClearableSetField(field)) {
      throw new Error(`field "${field}" cannot be cleared`);
    }
    return { [field]: null } as IssuePatch;
  }

  if (spec.type === "needsAttention") {
    const raw = resolveFileOrValue(value, opts.file);
    if (raw === undefined) {
      throw new Error(`provide a value for ${field}`);
    }
    const on = coerceBoolean(raw, field);
    if (on) {
      if (!opts.reason) {
        throw new Error("provide --reason <text> when setting needsAttention true");
      }
      return { needsAttention: true, attentionReason: opts.reason };
    }
    return { needsAttention: false, attentionReason: null };
  }

  if (spec.type === "description") {
    const raw = resolveFileOrValue(value, opts.file);
    if (raw === undefined) {
      throw new Error("provide a value or --file <path>");
    }
    return { description: raw };
  }

  const raw = resolveFileOrValue(value, opts.file);
  if (raw === undefined) {
    throw new Error(`provide a value for ${field}`);
  }

  switch (spec.type) {
    case "string":
      return { [field]: raw } as IssuePatch;
    case "commitSha":
      validateFullCommitSha(raw);
      return { commitSha: raw };
    case "boolean":
      return { [field]: coerceBoolean(raw, field) } as IssuePatch;
    case "enum":
      return { [field]: coerceEnum(raw, field, spec.values) } as IssuePatch;
    case "json":
      return { [field]: coerceJson(raw, field) } as IssuePatch;
  }
}

function formatGetValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function storedFieldValue(detail: IssueDetail, field: string): unknown {
  return (detail as Record<string, unknown>)[field];
}

export function kindGetValue(
  kind: IssueKind,
  id: string,
  field: string,
): string | null {
  const tables = KIND_GET_FIELDS[kind] as Record<
    string,
    { source: "stored" | "description" | "derived" }
  >;
  const spec = tables[field];
  if (!spec) {
    throw new Error(`unknown field "${field}" for ${kind}`);
  }

  const detail = assertKind(kind, id);

  if (spec.source === "description") {
    return formatGetValue(detail.description);
  }

  if (spec.source === "derived") {
    const { derived } = list();
    const state = derived[id];
    if (!state) return null;
    return formatGetValue(state[field as keyof typeof state]);
  }

  return formatGetValue(storedFieldValue(detail, field));
}

function currentArrayValue(detail: IssueDetail, field: string): string[] {
  const value = storedFieldValue(detail, field);
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`field "${field}" is not a string array on ${detail.kind}`);
  }
  return value;
}

function currentCatalogLabels(detail: IssueDetail): ProjectLabel[] {
  if (detail.kind !== "project") {
    throw new Error(`labels catalog is only on project (got ${detail.kind})`);
  }
  return detail.labels ?? [];
}

function currentSupportingDocs(detail: IssueDetail): SupportingDocs | undefined {
  if (detail.kind !== "project") {
    throw new Error(`supportingDocs is only on project (got ${detail.kind})`);
  }
  return detail.supportingDocs;
}

function currentInspirationApps(detail: IssueDetail): InspirationAppEntry[] {
  if (detail.kind !== "project") {
    throw new Error(`inspirationApps is only on project (got ${detail.kind})`);
  }
  return detail.inspirationApps ?? [];
}

export function kindSet(
  kind: IssueKind,
  id: string,
  field: string,
  value: string | undefined,
  opts: KindSetOptions,
): ReturnType<typeof update> {
  const detail = assertKind(kind, id);
  const tables = KIND_SET_FIELDS[kind] as Record<string, SetFieldSpec>;
  const spec = tables[field];
  if (!spec) {
    throw new Error(`unknown or unsettable field "${field}" for ${kind}`);
  }

  if (spec.type === "labelCatalog") {
    const result = resolveLabelCatalogSet(
      value,
      opts,
      currentCatalogLabels(detail),
    );
    if (result.action === "rename") {
      return renameProjectLabel(id, result.oldId, result.newId);
    }
    return update(id, result.patch);
  }

  if (spec.type === "supportingDocs") {
    if (value !== undefined) {
      throw new Error(
        "supportingDocs does not take a positional value; use --doc with --attachment or --workspace",
      );
    }
    return update(id, resolveSupportingDocsSet(opts, currentSupportingDocs(detail)));
  }

  if (spec.type === "inspirationApps") {
    return update(
      id,
      resolveInspirationAppsSet(value, opts, currentInspirationApps(detail)),
    );
  }

  const currentArray =
    spec.type === "array" ? currentArrayValue(detail, field) : undefined;
  const patch = coerceSetPatch(kind, field, value, opts, currentArray);
  return update(id, patch);
}

export function registerKindGetSet(
  program: Command,
  kind: IssueKind,
  run: (action: () => unknown) => Promise<void>,
): Command {
  const cmd = program.command(kind);

  cmd
    .command("get")
    .argument("<id>", `${kind} id`)
    .argument("<field>", "field name (camelCase)")
    .action((id: string, field: string) =>
      run(() => {
        const value = kindGetValue(kind, id, field);
        if (value === null) return;
        process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
      }),
    );

  cmd
    .command("set")
    .argument("<id>", `${kind} id`)
    .argument("<field>", "field name (camelCase)")
    .argument("[value]", "new value")
    .option("--clear", "clear the field")
    .option("--file <path>", "read value from a file (use - for stdin)")
    .option("--reason <text>", "required when setting needsAttention true")
    .option(
      "--add [ids...]",
      "union ids into an array field, or upsert a project label JSON object",
    )
    .option("--remove <ids...>", "drop ids from an array field")
    .option(
      "--rename <ids...>",
      "rename a project catalog label id (oldId newId)",
    )
    .option(
      "--doc <key>",
      "supportingDocs key: vision|codingStandards|designSystem",
    )
    .option(
      "--attachment <name>",
      "supportingDocs attachment basename already on the Project",
    )
    .option(
      "--workspace <path>",
      "for supportingDocs: workspace-relative file path",
    )
    .action(
      (id: string, field: string, value: string | undefined, opts: KindSetOptions) =>
        run(() => kindSet(kind, id, field, value, opts)),
    );

  return cmd;
}
