import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "@/features/issues/lib/build-tree";
import type { AgentModel } from "../api/client";
import { COMPOSER_25_MODEL_ID } from "@/features/issues/lib/planning-launch";
import {
  NEW_CONVERSATION_DEFAULT_PROJECT_ID,
  defaultNewConversationModelId,
  defaultNewConversationProjectId,
} from "./create-conversation-defaults";

function project(
  id: string,
  workspace?: string,
): ProjectRecord {
  return {
    id,
    kind: "project",
    title: id,
    ...(workspace !== undefined ? { workspace } : {}),
  } as ProjectRecord;
}

describe("defaultNewConversationProjectId", () => {
  it("returns pinned defaults when the workspace and catalog support them", () => {
    expect(
      defaultNewConversationProjectId([
        project(NEW_CONVERSATION_DEFAULT_PROJECT_ID, "/ws"),
      ]),
    ).toBe(NEW_CONVERSATION_DEFAULT_PROJECT_ID);

    const models: AgentModel[] = [
      { id: COMPOSER_25_MODEL_ID, displayName: "Composer 2.5" },
    ];
    expect(defaultNewConversationModelId(models)).toBe(COMPOSER_25_MODEL_ID);
  });
});