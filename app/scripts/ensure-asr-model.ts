#!/usr/bin/env -S npx tsx
// Download and extract the local speech-to-text model weights when absent.
//
// Wired to `postinstall` alongside the Playwright browser check so a fresh
// clone has everything voice dictation needs. Set ISSUE_TRACKER_SKIP_ASR_MODEL_SETUP=1
// to opt out of the download. Override the destination with ISSUE_TRACKER_ASR_MODEL_DIR.

import { spawnSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
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

function extractArchive(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync("tar", ["-xjf", archivePath, "-C", destDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`ASR model extraction failed (tar exit ${result.status ?? "unknown"})`);
  }
}

/** Resolve, download when needed, and return the absolute model directory path. */
export async function ensureAsrModel(): Promise<string> {
  const base = modelBaseDir();

  const existing = findPopulatedModelDir(base);
  if (existing) return existing;

  if (process.env[SKIP_ENV]) {
    console.log(`${SKIP_ENV} is set; skipping ASR model download.`);
    return base;
  }

  mkdirSync(base, { recursive: true });
  const archivePath = join(base, ARCHIVE_NAME);
  try {
    await downloadArchive(archivePath);
    extractArchive(archivePath, base);
  } finally {
    if (existsSync(archivePath)) rmSync(archivePath);
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
