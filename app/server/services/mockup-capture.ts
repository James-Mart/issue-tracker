import {
  directionDir,
  mockupScratchDir,
  readMockupStackState,
} from "./mockup-scratch.js";
import {
  captureStoryStates,
  type ViewportName,
} from "./mockup-story-capture.js";
import { listStoryStates } from "./mockup-story-states.js";
import { isMockupStackLive } from "./mockup-stack.js";

export interface MockupCaptureOptions {
  conversationId: string;
  directionId?: string;
  viewports?: ViewportName[];
  baseUrl?: string;
}

const VIEWPORT_NAMES: ViewportName[] = ["phone", "desktop"];

export function parseViewports(value: string): ViewportName[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error(
      `--viewports must be phone or phone,desktop, got ${JSON.stringify(value)}`,
    );
  }

  const viewports: ViewportName[] = [];
  for (const part of parts) {
    if (part !== "phone" && part !== "desktop") {
      throw new Error(
        `--viewports must be phone or phone,desktop, got ${JSON.stringify(value)}`,
      );
    }
    if (!viewports.includes(part)) {
      viewports.push(part);
    }
  }

  if (viewports.length === 1 && viewports[0] === "desktop") {
    throw new Error(
      `--viewports must be phone or phone,desktop, got ${JSON.stringify(value)}`,
    );
  }

  return viewports;
}

export function resolveMockupCaptureBaseUrl(
  conversationId: string,
  baseUrlOverride?: string,
): string {
  if (baseUrlOverride !== undefined) {
    return baseUrlOverride.replace(/\/$/, "");
  }

  const state = readMockupStackState(conversationId);
  if (!state || !isMockupStackLive(state)) {
    throw new Error(
      `no mockup stack running for conversation ${JSON.stringify(conversationId)}`,
    );
  }

  return state.baseUrl;
}

export function mockupCaptureOutDir(
  conversationId: string,
  directionId?: string,
): string {
  if (directionId !== undefined) {
    return directionDir(conversationId, directionId);
  }
  return mockupScratchDir(conversationId);
}

export async function captureMockupStories(
  options: MockupCaptureOptions,
): Promise<string[]> {
  const viewports = options.viewports ?? (["phone"] as ViewportName[]);
  for (const viewport of viewports) {
    if (!VIEWPORT_NAMES.includes(viewport)) {
      throw new Error(`unsupported viewport ${JSON.stringify(viewport)}`);
    }
  }

  const baseUrl = resolveMockupCaptureBaseUrl(
    options.conversationId,
    options.baseUrl,
  );
  const outDir = mockupCaptureOutDir(
    options.conversationId,
    options.directionId,
  );
  const states = await listStoryStates(baseUrl, options.directionId);
  const results = await captureStoryStates({
    baseUrl,
    outDir,
    states,
    viewports,
  });

  return results.map((result) => result.absolutePath);
}
