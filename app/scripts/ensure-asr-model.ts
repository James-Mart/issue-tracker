#!/usr/bin/env -S npx tsx
// Download and extract the local speech-to-text model weights when absent.
//
// Wired to `postinstall` alongside the Playwright browser check so a fresh
// clone has everything voice dictation needs. Set ISSUE_TRACKER_SKIP_ASR_MODEL_SETUP=1
// to opt out of the download. Override the destination with ISSUE_TRACKER_ASR_MODEL_DIR.

import { spawnSync } from "child_process";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
} from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL_DIR = join(APP_DIR, ".asr-models");
const MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2";
const ARCHIVE_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2";
const REQUIRED_FILES = [
  "encoder.int8.onnx",
  "decoder.int8.onnx",
  "joiner.int8.onnx",
  "tokens.txt",
] as const;

const SKIP_ENV = "ISSUE_TRACKER_SKIP_ASR_MODEL_SETUP";
const MODEL_DIR_ENV = "ISSUE_TRACKER_ASR_MODEL_DIR";

function modelBaseDir(): string {
  const override = process.env[MODEL_DIR_ENV]?.trim();
  return override ? resolve(override) : DEFAULT_MODEL_DIR;
}

function hasRequiredFiles(dir: string): boolean {
  return REQUIRED_FILES.every((name) => existsSync(join(dir, name)));
}

/** Directory containing the four model files, or null when not provisioned. */
function findPopulatedModelDir(base: string): string | null {
  if (hasRequiredFiles(base)) return base;
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = join(base, entry.name);
    if (hasRequiredFiles(sub)) return sub;
  }
  return null;
}

async function downloadArchive(dest: string): Promise<void> {
  console.log(`Downloading ASR model (~460 MB compressed) from ${MODEL_URL} ...`);
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`ASR model download failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("ASR model download failed: empty response body");
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function waitForPopulatedModelDir(base: string): Promise<string | null> {
  const lockPath = join(base, `${ARCHIVE_NAME}.lock`);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const populated = findPopulatedModelDir(base);
    if (populated) return populated;
    if (!existsSync(lockPath)) return findPopulatedModelDir(base);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return findPopulatedModelDir(base);
}

function extractArchive(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync("tar", ["-xjf", archivePath, "-C", destDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`ASR model extraction failed (tar exit ${result.status ?? "unknown"})`);
  }
}

/** Return the populated model directory when weights are already on disk. */
export function resolveAsrModelDirIfPresent(): string | null {
  return findPopulatedModelDir(modelBaseDir());
}

/** Whether `dir` contains the four ONNX/token files voice dictation needs. */
export function asrModelFilesPresent(dir: string): boolean {
  return hasRequiredFiles(dir);
}

let inFlight: Promise<string> | null = null;
let provisionPending = false;

/** True while a download/extract is running and the weights are not on disk yet. */
export function isAsrModelProvisionInFlight(): boolean {
  return provisionPending && resolveAsrModelDirIfPresent() === null;
}

/** Resolve, download when needed, and return the absolute model directory path. */
export async function ensureAsrModel(): Promise<string> {
  if (inFlight) return inFlight;
  provisionPending = true;
  inFlight = provisionAsrModel()
    .finally(() => {
      provisionPending = false;
    })
    .catch((err) => {
      inFlight = null;
      throw err;
    });
  return inFlight;
}

async function provisionAsrModel(): Promise<string> {
  const base = modelBaseDir();

  const existing = findPopulatedModelDir(base);
  if (existing) return existing;

  if (process.env[SKIP_ENV]) {
    console.log(`${SKIP_ENV} is set; skipping ASR model download.`);
    return base;
  }

  mkdirSync(base, { recursive: true });
  const lockPath = join(base, `${ARCHIVE_NAME}.lock`);
  try {
    const fd = openSync(lockPath, "wx");
    closeSync(fd);
  } catch {
    const sibling = await waitForPopulatedModelDir(base);
    if (sibling) return sibling;
  }

  const archivePath = join(base, ARCHIVE_NAME);
  try {
    await downloadArchive(archivePath);
    extractArchive(archivePath, base);
  } finally {
    if (existsSync(archivePath)) rmSync(archivePath);
    if (existsSync(lockPath)) rmSync(lockPath);
  }

  const populated = findPopulatedModelDir(base);
  if (!populated) {
    throw new Error(
      `ASR model extraction completed but required files are missing under ${base}`,
    );
  }

  console.log(`ASR model ready at ${populated}`);
  return populated;
}

async function main(): Promise<void> {
  await ensureAsrModel();
}

const isMain =
  import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
