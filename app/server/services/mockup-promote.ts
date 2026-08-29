import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MAX_ATTACHMENT_BYTES,
  getAttachment,
  listAttachments,
  putAttachment,
  removeAttachment,
} from "./attachments.js";
import {
  listConversationAttachments,
  putConversationAttachment,
} from "./conversation-attachments.js";
import { captureMockupStoryStates } from "./mockup-capture.js";
import {
  directionDir,
  harnessConfigPath,
  listDirectionIds,
  resolveMockupConversationId,
} from "./mockup-scratch.js";
import type { CaptureResult, ViewportName } from "./mockup-story-capture.js";
import { slugify } from "./slug.js";

export type PromoteMode = "candidate" | "chosen" | "copy";

export interface PromoteOptions {
  mode: PromoteMode;
  directionId: string;
  issueId?: string;
  conversationId?: string;
  fromIssueId?: string;
}

export interface PromoteResult {
  attached: string[];
  capturePaths: string[];
}

export interface PendingAttachment {
  name: string;
  bytes: Uint8Array;
}

const CANDIDATE_PREFIX = "mockup-candidate-";
const STORY_FILE_RE = /\.stories\.(tsx|ts|jsx|js|mdx)$/;

export function stateSlug(storyId: string, directionId: string): string {
  const slug = slugify(storyId);
  const directionPrefix = `${slugify(directionId)}-`;
  if (slug.startsWith(directionPrefix)) {
    return slug.slice(directionPrefix.length);
  }
  return slug;
}

export function candidateAttachmentName(
  directionId: string,
  storyId: string,
  viewport: ViewportName,
  revision: number,
): string {
  return `${CANDIDATE_PREFIX}${directionId}-r${revision}-${stateSlug(storyId, directionId)}-${viewport}.png`;
}

export async function nextCandidateRevision(
  conversationId: string,
  directionId: string,
): Promise<number> {
  const attachments = await listConversationAttachments(conversationId);
  const prefix = candidateAttachmentPrefix(directionId);
  let max = 0;
  for (const attachment of attachments) {
    if (!attachment.name.startsWith(prefix)) continue;
    const rest = attachment.name.slice(prefix.length);
    const match = rest.match(/^r(\d+)-/);
    if (match) {
      max = Math.max(max, Number.parseInt(match[1]!, 10));
    }
  }
  return max + 1;
}

export function chosenAttachmentName(
  directionId: string,
  storyId: string,
  viewport: ViewportName,
): string {
  return `mockup-${directionId}-${stateSlug(storyId, directionId)}-${viewport}.png`;
}

export function chosenArchiveName(directionId: string): string {
  return `mockup-${directionId}.tar.gz`;
}

export function chosenPngPrefix(directionId: string): string {
  return `mockup-${directionId}-`;
}

export function candidateAttachmentPrefix(directionId: string): string {
  return `${CANDIDATE_PREFIX}${directionId}-`;
}

function directionIdsFromArchives(names: string[]): string[] {
  return names
    .filter(
      (name) =>
        name.startsWith("mockup-") &&
        name.endsWith(".tar.gz") &&
        !name.startsWith(CANDIDATE_PREFIX),
    )
    .map((name) => name.slice("mockup-".length, -".tar.gz".length));
}

function knownDirectionIds(
  attachmentNames: string[],
  conversationId: string,
): string[] {
  return [
    ...new Set([
      ...directionIdsFromArchives(attachmentNames),
      ...listDirectionIds(conversationId),
    ]),
  ];
}

export function matchesChosenPngPrefix(
  name: string,
  directionId: string,
  otherDirectionIds: Iterable<string> = [],
): boolean {
  const prefix = chosenPngPrefix(directionId);
  if (!name.startsWith(prefix)) return false;
  if (!name.endsWith("-phone.png") && !name.endsWith("-desktop.png")) {
    return false;
  }
  for (const other of otherDirectionIds) {
    if (
      other !== directionId &&
      other.startsWith(`${directionId}-`) &&
      name.startsWith(chosenPngPrefix(other))
    ) {
      return false;
    }
  }
  return true;
}

const CHOSEN_PNG_COLLISION_SUFFIX_RE = /-(phone|desktop)-(\d+)\.png$/;

function isChosenPngViewportSuffix(name: string): boolean {
  if (name.endsWith("-phone.png") || name.endsWith("-desktop.png")) {
    return true;
  }
  const match = name.match(CHOSEN_PNG_COLLISION_SUFFIX_RE);
  if (!match) return false;
  return Number.parseInt(match[2]!, 10) >= 2;
}

export function matchesChosenPngForReplace(
  name: string,
  directionId: string,
  otherDirectionIds: Iterable<string> = [],
): boolean {
  const prefix = chosenPngPrefix(directionId);
  if (!name.startsWith(prefix)) return false;
  if (!isChosenPngViewportSuffix(name)) return false;
  for (const other of otherDirectionIds) {
    if (
      other !== directionId &&
      other.startsWith(`${directionId}-`) &&
      name.startsWith(chosenPngPrefix(other))
    ) {
      return false;
    }
  }
  return true;
}

export function matchesChosenArchiveForReplace(
  name: string,
  directionId: string,
): boolean {
  if (name === chosenArchiveName(directionId)) return true;
  const prefix = `mockup-${directionId}.tar-`;
  if (!name.startsWith(prefix) || !name.endsWith(".gz")) return false;
  const n = name.slice(prefix.length, -".gz".length);
  const parsed = Number.parseInt(n, 10);
  return Number.isInteger(parsed) && parsed >= 2 && String(parsed) === n;
}

type CopyPromoteOptions = PromoteOptions & {
  mode: "copy";
  issueId: string;
  fromIssueId: string;
  conversationId?: undefined;
};

type CandidatePromoteOptions = PromoteOptions & {
  mode: "candidate";
  conversationId: string;
  issueId?: undefined;
  fromIssueId?: undefined;
};

type ChosenPromoteOptions = PromoteOptions & {
  mode: "chosen";
  issueId: string;
  conversationId: string;
  fromIssueId?: undefined;
};

function assertModeFlags(
  options: PromoteOptions,
): CopyPromoteOptions | CandidatePromoteOptions | ChosenPromoteOptions {
  if (options.mode === "copy") {
    if (!options.issueId) {
      throw new Error("--issue is required for --mode copy");
    }
    if (!options.fromIssueId) {
      throw new Error("--from-issue is required for --mode copy");
    }
    if (options.conversationId !== undefined) {
      throw new Error("--conversation is not used with --mode copy");
    }
    return options as CopyPromoteOptions;
  }

  if (!options.conversationId) {
    throw new Error("--conversation is required for capturing modes");
  }
  if (options.fromIssueId !== undefined) {
    throw new Error("--from-issue is not used with capturing modes");
  }
  if (options.mode === "candidate") {
    if (options.issueId !== undefined) {
      throw new Error("--issue is not used with --mode candidate");
    }
    return options as CandidatePromoteOptions;
  }
  if (!options.issueId) {
    throw new Error("--issue is required for --mode chosen");
  }
  return options as ChosenPromoteOptions;
}

function collectStoryRelPaths(dir: string, relative = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative ? `${relative}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) {
      found.push(...collectStoryRelPaths(full, rel));
    } else if (st.isFile() && STORY_FILE_RE.test(name)) {
      found.push(rel);
    }
  }
  return found;
}

function copyFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from));
}

export function createDirectionArchive(
  conversationId: string,
  directionId: string,
): string {
  const harnessPath = harnessConfigPath(conversationId);
  if (!existsSync(harnessPath)) {
    throw new Error(`missing mockup harness configuration at ${harnessPath}`);
  }

  const storiesDir = directionDir(conversationId, directionId);
  const storyRels = collectStoryRelPaths(storiesDir);
  if (storyRels.length === 0) {
    throw new Error(
      `no story files for direction ${JSON.stringify(directionId)}`,
    );
  }

  const staging = mkdtempSync(join(tmpdir(), "mockup-promote-archive-"));
  const archivePath = join(staging, chosenArchiveName(directionId));
  try {
    copyFile(harnessPath, join(staging, "harness.json"));
    for (const rel of storyRels) {
      copyFile(join(storiesDir, rel), join(staging, rel));
    }

    const packed = spawnSync(
      "tar",
      ["-czf", archivePath, "-C", staging, "harness.json", ...storyRels],
      { encoding: "utf8" },
    );
    if (packed.status !== 0) {
      throw new Error(
        `failed to create archive ${chosenArchiveName(directionId)}: ${packed.stderr || packed.stdout}`,
      );
    }
    return archivePath;
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

export function assertAttachmentSizes(files: PendingAttachment[]): void {
  for (const file of files) {
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `attachment ${JSON.stringify(file.name)} exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
      );
    }
  }
}

async function attachAll(
  issueId: string,
  files: PendingAttachment[],
): Promise<string[]> {
  assertAttachmentSizes(files);
  const attached: string[] = [];
  for (const file of files) {
    const meta = await putAttachment(issueId, file.name, file.bytes);
    attached.push(meta.name);
  }
  return attached;
}

async function attachAllConversation(
  conversationId: string,
  files: PendingAttachment[],
): Promise<string[]> {
  assertAttachmentSizes(files);
  const attached: string[] = [];
  for (const file of files) {
    const meta = await putConversationAttachment(
      conversationId,
      file.name,
      Buffer.from(file.bytes),
    );
    attached.push(meta.name);
  }
  return attached;
}

export async function detachChosenPngsForDirection(
  issueId: string,
  directionId: string,
  conversationId: string,
): Promise<string[]> {
  const allNames = listAttachments(issueId).map((att) => att.name);
  const otherDirectionIds = knownDirectionIds(allNames, conversationId);
  const names = allNames.filter((name) =>
    matchesChosenPngForReplace(name, directionId, otherDirectionIds),
  );
  for (const name of names) {
    await removeAttachment(issueId, name);
  }
  return names;
}

export async function detachChosenArchiveForDirection(
  issueId: string,
  directionId: string,
): Promise<string[]> {
  const names = listAttachments(issueId)
    .map((att) => att.name)
    .filter((name) => matchesChosenArchiveForReplace(name, directionId));
  for (const name of names) {
    await removeAttachment(issueId, name);
  }
  return names;
}

function pendingFromCaptures(
  mode: "candidate" | "chosen",
  directionId: string,
  captures: CaptureResult[],
  candidateRevision?: number,
): { files: PendingAttachment[]; capturePaths: string[] } {
  const files: PendingAttachment[] = [];
  const capturePaths: string[] = [];
  for (const capture of captures) {
    const name =
      mode === "candidate"
        ? candidateAttachmentName(
            directionId,
            capture.storyId,
            capture.viewport,
            candidateRevision!,
          )
        : chosenAttachmentName(directionId, capture.storyId, capture.viewport);
    files.push({
      name,
      bytes: readFileSync(capture.absolutePath),
    });
    capturePaths.push(capture.absolutePath);
  }
  return { files, capturePaths };
}

export async function attachCapturedDirection(options: {
  mode: "candidate" | "chosen";
  conversationId: string;
  directionId: string;
  issueId?: string;
  captures: CaptureResult[];
}): Promise<PromoteResult> {
  const resolvedConversationId = resolveMockupConversationId(
    options.conversationId,
  );

  if (options.mode === "candidate") {
    const revision = await nextCandidateRevision(
      resolvedConversationId,
      options.directionId,
    );
    const pending = pendingFromCaptures(
      options.mode,
      options.directionId,
      options.captures,
      revision,
    );
    const attached = await attachAllConversation(
      resolvedConversationId,
      pending.files,
    );
    return { attached, capturePaths: pending.capturePaths };
  }

  listAttachments(options.issueId!);

  const pending = pendingFromCaptures(
    options.mode,
    options.directionId,
    options.captures,
  );
  if (options.mode === "chosen") {
    await detachChosenPngsForDirection(
      options.issueId!,
      options.directionId,
      options.conversationId,
    );
    await detachChosenArchiveForDirection(
      options.issueId!,
      options.directionId,
    );
    const archivePath = createDirectionArchive(
      options.conversationId,
      options.directionId,
    );
    try {
      pending.files.push({
        name: chosenArchiveName(options.directionId),
        bytes: readFileSync(archivePath),
      });
    } finally {
      rmSync(dirname(archivePath), { recursive: true, force: true });
    }
  }

  const attached = await attachAll(options.issueId!, pending.files);
  return { attached, capturePaths: pending.capturePaths };
}

export async function copyDirectionArtifacts(options: {
  fromIssueId: string;
  issueId: string;
  directionId: string;
}): Promise<PromoteResult> {
  listAttachments(options.issueId);
  const source = listAttachments(options.fromIssueId);
  const archive = chosenArchiveName(options.directionId);
  const otherDirectionIds = directionIdsFromArchives(
    source.map((att) => att.name),
  );
  const names = source
    .map((att) => att.name)
    .filter(
      (name) =>
        name === archive ||
        matchesChosenPngPrefix(name, options.directionId, otherDirectionIds),
    );

  if (!names.includes(archive)) {
    throw new Error(
      `attachment ${JSON.stringify(archive)} not found on ${JSON.stringify(options.fromIssueId)}`,
    );
  }

  const files: PendingAttachment[] = [];
  for (const name of names) {
    const { bytes } = await getAttachment(options.fromIssueId, name);
    files.push({ name, bytes });
  }

  const attached = await attachAll(options.issueId, files);
  return { attached, capturePaths: [] };
}

export async function promoteMockup(
  options: PromoteOptions,
): Promise<PromoteResult> {
  const checked = assertModeFlags(options);

  if (checked.mode === "copy") {
    return copyDirectionArtifacts({
      fromIssueId: checked.fromIssueId,
      issueId: checked.issueId,
      directionId: checked.directionId,
    });
  }

  const viewports: ViewportName[] = ["phone", "desktop"];
  const captures = await captureMockupStoryStates({
    conversationId: checked.conversationId,
    directionId: checked.directionId,
    viewports,
  });

  return attachCapturedDirection({
    mode: checked.mode,
    conversationId: checked.conversationId,
    directionId: checked.directionId,
    issueId: checked.mode === "chosen" ? checked.issueId : undefined,
    captures,
  });
}
