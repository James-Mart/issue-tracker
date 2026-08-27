import { z } from "zod";

export interface StoryState {
  id: string;
  title: string;
  name: string;
}

const storyIndexEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
});

const storyIndexSchema = z.object({
  entries: z.record(z.string(), storyIndexEntrySchema),
});

function indexUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("index.json", normalized).href;
}

function matchesDirection(title: string, directionId: string): boolean {
  return title === directionId || title.startsWith(`${directionId}/`);
}

function parseStoryIndex(body: unknown, url: string): StoryState[] {
  const parsed = storyIndexSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`unparseable story index at ${url}: ${parsed.error.message}`);
  }

  return Object.values(parsed.data.entries)
    .filter((entry) => entry.type === "story")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      name: entry.name,
    }));
}

export async function listStoryStates(
  baseUrl: string,
  directionId?: string,
): Promise<StoryState[]> {
  const url = indexUrl(baseUrl);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to fetch story index from ${url}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      `failed to fetch story index from ${url}: status ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`unparseable story index at ${url}: ${message}`);
  }

  let states = parseStoryIndex(body, url);

  if (directionId !== undefined) {
    states = states.filter((state) => matchesDirection(state.title, directionId));
    if (states.length === 0) {
      throw new Error(
        `no story states for direction ${JSON.stringify(directionId)}`,
      );
    }
  }

  return states;
}
