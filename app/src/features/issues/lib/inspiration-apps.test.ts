import { describe, expect, it } from "vitest";
import { inspirationAppsFromDraftsPreservingIncomplete } from "./inspiration-apps";

const notion = {
  name: "Notion",
  url: "https://notion.so",
  description: "Notes",
};

describe("inspirationAppsFromDraftsPreservingIncomplete", () => {
  it("keeps persisted entry when an existing row is incomplete", () => {
    expect(
      inspirationAppsFromDraftsPreservingIncomplete(
        [
          {
            key: "Notion",
            name: "",
            url: "https://notion.so",
            description: "mid-edit",
          },
        ],
        [notion],
      ),
    ).toEqual([notion]);
  });
});
