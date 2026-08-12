import { describe, expect, it } from "vitest";
import { buildCreateConversationBody } from "./create-conversation-dialog";

describe("buildCreateConversationBody", () => {
  const fields = {
    projectId: "issue-tracker",
    model: "composer-2.5",
    title: "Custom title",
  };

  it("omits title and message for General conversations", () => {
    expect(buildCreateConversationBody("general", fields)).toEqual({
      projectId: "issue-tracker",
      model: "composer-2.5",
      title: "Custom title",
    });
  });

  it("defaults General conversations without a custom title", () => {
    expect(
      buildCreateConversationBody("general", {
        ...fields,
        title: "   ",
      }),
    ).toEqual({
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
  });

  it("sends the vision launch title and message for Vision refinement", () => {
    expect(buildCreateConversationBody("vision-refinement", fields)).toEqual({
      projectId: "issue-tracker",
      model: "composer-2.5",
      title: "Vision refinement",
      message:
        "Refine vision for issue-tracker in the issue tracker using the issue-tracker-vision-docs skill.",
    });
  });
});
