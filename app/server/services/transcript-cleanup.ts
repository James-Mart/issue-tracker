import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pluginDir } from "../config.js";
import {
  agentSdk,
  type AgentHandle,
  type AgentSdk,
  type AgentStreamEvent,
} from "./agent-sdk.js";

export const TRANSCRIPT_CLEANUP_MODEL = "composer-2.5-fast";
export const TRANSCRIPT_CLEANUP_TIMEOUT_MS = 5_000;

function cleanupStoreDir(): string {
  return join(tmpdir(), "issue-tracker-transcript-cleanup-agent-state");
}

function cleanupPrompt(text: string): string {
  return (
    "Remove fillers and false starts from the transcript. Do not rephrase. " +
    "Reply with only the cleaned transcript.\n\n" +
    text
  );
}

function assistantText(event: AgentStreamEvent): string {
  if (event.kind !== "message" || event.message.type !== "assistant") {
    return "";
  }
  let out = "";
  for (const block of event.message.message.content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Strip disfluencies from a punctuated transcript through the existing SDK
 * seam. Failures and timeouts return the input unchanged: the raw transcript
 * is already usable, and a slow model must not hold the composer in
 * transcribing.
 */
export async function cleanTranscript(
  text: string,
  sdk: AgentSdk = agentSdk,
): Promise<string> {
  let handle: AgentHandle | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = (async () => {
    const storeDir = cleanupStoreDir();
    mkdirSync(storeDir, { recursive: true });
    handle = await sdk.createAgent({
      cwd: pluginDir,
      model: { id: TRANSCRIPT_CLEANUP_MODEL },
      storeDir,
      tools: [],
    });
    const run = await handle.send(cleanupPrompt(text));
    let cleaned = "";
    for await (const event of run) {
      cleaned += assistantText(event);
    }
    const result = await run.wait();
    if (result.status !== "finished") {
      throw new Error(result.error?.message ?? `cleanup run ${result.status}`);
    }
    return cleaned;
  })();
  void work.catch(() => {});

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`timed out after ${TRANSCRIPT_CLEANUP_TIMEOUT_MS}ms`),
      );
    }, TRANSCRIPT_CLEANUP_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    console.error(`transcript cleanup failed: ${reasonOf(err)}`);
    try {
      await handle?.cancel();
    } catch {
      // Cancel is best-effort once we have already chosen the fallback.
    }
    return text;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (handle) {
      try {
        await handle[Symbol.asyncDispose]();
      } catch {
        // Dispose must not hide a successful cleanup or the fallback.
      }
    }
  }
}
