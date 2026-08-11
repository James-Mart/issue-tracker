import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  type LocalAgentRunDocument,
} from "@cursor/sdk";

function runsPath(storeDir: string): string {
  return resolve(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
}

function checkpointRootBlobId(
  ref: LocalAgentRunDocument["startCheckpointRef"],
): string | undefined {
  return ref?.rootBlobId;
}

async function newestRunForAgent(
  storeDir: string,
  agentId: string,
): Promise<LocalAgentRunDocument | null> {
  const filePath = runsPath(storeDir);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let newest: LocalAgentRunDocument | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as LocalAgentRunDocument;
    if (row.agentId !== agentId) continue;
    if (
      !newest ||
      row.updatedAt > newest.updatedAt ||
      (row.updatedAt === newest.updatedAt && row.runId >= newest.runId)
    ) {
      newest = row;
    }
  }
  return newest;
}

/** Whether the agent's latest run moved its checkpoint forward. */
export async function turnMadeProgress(
  storeDir: string,
  agentId: string,
): Promise<boolean> {
  const run = await newestRunForAgent(storeDir, agentId);
  if (!run) return false;
  return (
    checkpointRootBlobId(run.startCheckpointRef) !==
    checkpointRootBlobId(run.latestCheckpointRef)
  );
}
