import { mockupStorybookBase } from "./mockup-stack.js";
import {
  listDirectionIds,
  readMockupStackState,
  resolveMockupConversationId,
} from "./mockup-scratch.js";
import {
  chooseLiveStoryForDirection,
  listStoryStates,
} from "./mockup-story-states.js";

export interface LiveStorybookLink {
  directionId: string;
  storyId: string;
  href: string;
  markdown: string;
}

export function liveStorybookHref(
  conversationId: string,
  storyId: string,
): string {
  const params = new URLSearchParams({
    path: `/story/${storyId}`,
    nav: "0",
  });
  return `${mockupStorybookBase(conversationId)}?${params.toString()}`;
}

export function liveStorybookLinkMarkdown(
  conversationId: string,
  storyId: string,
): string {
  return `[Open live Storybook](${liveStorybookHref(conversationId, storyId)})`;
}

export async function resolveLiveStorybookLink(
  conversationId: string,
  directionId: string,
  baseUrl: string,
): Promise<LiveStorybookLink> {
  const resolvedId = resolveMockupConversationId(conversationId);
  const states = await listStoryStates(baseUrl, directionId);
  const story = chooseLiveStoryForDirection(states);
  const href = liveStorybookHref(resolvedId, story.id);
  return {
    directionId,
    storyId: story.id,
    href,
    markdown: `[Open live Storybook](${href})`,
  };
}

export async function listLiveStorybookLinks(
  conversationId: string,
  directionIds?: string[],
): Promise<LiveStorybookLink[]> {
  const resolvedId = resolveMockupConversationId(conversationId);
  const state = readMockupStackState(resolvedId);
  if (state === null) {
    throw new Error(
      `no mockup stack recorded for conversation ${JSON.stringify(conversationId)}`,
    );
  }

  const directions =
    directionIds !== undefined && directionIds.length > 0
      ? directionIds
      : listDirectionIds(resolvedId);
  if (directions.length === 0) {
    throw new Error(
      `no mockup directions for conversation ${JSON.stringify(conversationId)}`,
    );
  }

  const links: LiveStorybookLink[] = [];
  for (const directionId of directions) {
    links.push(
      await resolveLiveStorybookLink(resolvedId, directionId, state.baseUrl),
    );
  }
  return links;
}
