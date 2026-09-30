import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pluginDir } from "../config.js";
import { parseConversationMeta } from "../schemas.js";
import { mainCheckoutRoot } from "./git-read.js";
import { AGENT_STACK_DATA_DIR_ENV, realPath } from "./guest-boot.js";

export const DEFAULT_CONVERSATION_CAP = 50;
export const DEFAULT_BYTE_CAP = 500 * 1024 * 1024;
export const CONVERSATION_CAP_ENV = "GUEST_STORE_COPY_CONVERSATION_CAP";
export const BYTE_CAP_ENV = "GUEST_STORE_COPY_BYTE_CAP";
export const STORE_LOCK_NAME = ".store.lock";
const SKIP_CONVERSATION_SUBDIRS = new Set(["agent-state", "agent-stack"]);
const PEER_CONFIG_FILES = ["app-config.json", "model-slug-catalog.json"] as const;

export type CopyGuestStoreOptions = {
  into: string;
  sourceRoot?: string;
  dataDir?: string;
  conversationCap?: number;
  byteCap?: number;
};

export type CopyGuestStoreResult = {
  issues: number;
  conversations: number;
  bytes: number;
};

type ConversationCandidate = {
  id: string;
  updatedAt: string;
};

function liveSourceRoot(checkout: string): string {
  try {
    return mainCheckoutRoot(checkout);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`copy-guest-store refused: ${detail}`);
  }
}

function resolvedUnderData(into: string, dataDir: string): string {
  const dataResolved = resolve(dataDir);
  const dataReal = realPath(dataDir) ?? dataResolved;
  const intoResolved = resolve(into);
  if (intoResolved === dataResolved || intoResolved.startsWith(dataResolved + sep)) {
    if (intoResolved === dataResolved) return dataReal;
    return join(dataReal, intoResolved.slice(dataResolved.length + 1));
  }
  return realPath(into) ?? intoResolved;
}

function copyGuestStoreRefusal(into: string, dataDir: string | undefined): string {
  const intoResolved = resolve(into);
  if (!dataDir) {
    return `copy-guest-store refused: --into ${intoResolved} is not under AGENT_STACK_DATA_DIR unset`;
  }
  const dataReal = realPath(dataDir);
  if (!dataReal) {
    return `copy-guest-store refused: AGENT_STACK_DATA_DIR ${resolve(dataDir)} is missing`;
  }
  const intoForCheck = resolvedUnderData(into, dataDir);
  if (intoForCheck !== dataReal && !intoForCheck.startsWith(dataReal + sep)) {
    return `copy-guest-store refused: --into ${intoForCheck} is not under AGENT_STACK_DATA_DIR ${dataReal}`;
  }
  const targetIssues = join(intoForCheck, "issues");
  if (existsSync(targetIssues)) {
    return `copy-guest-store refused: ${intoForCheck} already holds a store at ${targetIssues}`;
  }
  return "";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`copy-guest-store refused: invalid cap "${raw}"`);
  }
  return value;
}

function conversationSubtreeAllowed(sourceDir: string, src: string): boolean {
  const rel = relative(sourceDir, src);
  if (!rel || rel === ".") return true;
  const top = rel.split(sep)[0]!;
  return !SKIP_CONVERSATION_SUBDIRS.has(top);
}

type ConversationCopyPlan = {
  bytes: number;
  relPaths: string[];
};

function planConversationCopy(sourceDir: string): ConversationCopyPlan {
  const relPaths: string[] = [];
  let bytes = 0;
  const walk = (dir: string, relPrefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (!conversationSubtreeAllowed(sourceDir, full)) continue;
      const relPath = relPrefix ? join(relPrefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else if (entry.isFile()) {
        relPaths.push(relPath);
        bytes += statSync(full).size;
      }
    }
  };
  walk(sourceDir, "");
  return { bytes, relPaths };
}

function copyConversationPlan(
  sourceDir: string,
  destDir: string,
  plan: ConversationCopyPlan,
): void {
  mkdirSync(destDir, { recursive: true });
  for (const relPath of plan.relPaths) {
    const src = join(sourceDir, relPath);
    const dest = join(destDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { preserveTimestamps: true });
  }
}

function readConversationCandidate(
  conversationsDir: string,
  id: string,
): ConversationCandidate | undefined {
  const metaPath = join(conversationsDir, id, "meta.json");
  if (!existsSync(metaPath)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`copy-guest-store refused: ${metaPath} is not valid JSON (${detail})`);
  }
  const parsed = parseConversationMeta(raw);
  if (!parsed.ok) {
    throw new Error(`copy-guest-store refused: ${metaPath} ${parsed.message}`);
  }
  return { id, updatedAt: parsed.meta.updatedAt };
}

function listConversationCandidates(conversationsDir: string): ConversationCandidate[] {
  if (!existsSync(conversationsDir)) return [];
  const candidates: ConversationCandidate[] = [];
  for (const entry of readdirSync(conversationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = readConversationCandidate(conversationsDir, entry.name);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return candidates;
}

function copyIssuesStore(sourceIssues: string, destIssues: string): number {
  if (!existsSync(sourceIssues)) {
    throw new Error(`copy-guest-store refused: source issues store missing at ${sourceIssues}`);
  }
  mkdirSync(destIssues, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(sourceIssues, { withFileTypes: true })) {
    if (entry.name === STORE_LOCK_NAME) continue;
    const src = join(sourceIssues, entry.name);
    const dest = join(destIssues, entry.name);
    cpSync(src, dest, { recursive: true, preserveTimestamps: true });
    if (entry.isDirectory()) count++;
  }
  return count;
}

function copyPeerConfig(sourceRoot: string, destRoot: string): void {
  mkdirSync(destRoot, { recursive: true });
  for (const name of PEER_CONFIG_FILES) {
    const src = join(sourceRoot, name);
    if (!existsSync(src)) continue;
    cpSync(src, join(destRoot, name), { preserveTimestamps: true });
  }
}

function copySelectedConversations(
  sourceConversations: string,
  targetConversations: string,
  candidates: ConversationCandidate[],
  conversationCap: number,
  byteCap: number,
): { conversations: number; bytes: number } {
  mkdirSync(targetConversations, { recursive: true });
  let conversations = 0;
  let bytes = 0;
  for (const candidate of candidates) {
    if (conversations >= conversationCap) break;
    const sourceDir = join(sourceConversations, candidate.id);
    const plan = planConversationCopy(sourceDir);
    if (bytes + plan.bytes > byteCap) continue;
    copyConversationPlan(
      sourceDir,
      join(targetConversations, candidate.id),
      plan,
    );
    bytes += plan.bytes;
    conversations += 1;
  }
  return { conversations, bytes };
}

/** Copy the live tracker store from the main checkout into a guest data directory. */
export function copyGuestStore(
  options: CopyGuestStoreOptions,
): CopyGuestStoreResult {
  const sourceRoot = options.sourceRoot ?? liveSourceRoot(pluginDir);
  const dataDir = options.dataDir ?? process.env[AGENT_STACK_DATA_DIR_ENV];
  const refusal = copyGuestStoreRefusal(options.into, dataDir);
  if (refusal) throw new Error(refusal);

  const targetRoot = resolvedUnderData(options.into, dataDir!);
  const conversationCap =
    options.conversationCap ??
    parsePositiveInt(process.env[CONVERSATION_CAP_ENV], DEFAULT_CONVERSATION_CAP);
  const byteCap =
    options.byteCap ??
    parsePositiveInt(process.env[BYTE_CAP_ENV], DEFAULT_BYTE_CAP);

  const sourceIssues = join(sourceRoot, "issues");
  const sourceConversations = join(sourceRoot, "conversations");
  const issues = copyIssuesStore(sourceIssues, join(targetRoot, "issues"));
  copyPeerConfig(sourceRoot, targetRoot);

  const { conversations, bytes } = copySelectedConversations(
    sourceConversations,
    join(targetRoot, "conversations"),
    listConversationCandidates(sourceConversations),
    conversationCap,
    byteCap,
  );

  return { issues, conversations, bytes };
}

export function formatCopyGuestStoreResult(result: CopyGuestStoreResult): string {
  return [
    `issues=${result.issues}`,
    `conversations=${result.conversations}`,
    `bytes=${result.bytes}`,
  ].join("\n");
}
