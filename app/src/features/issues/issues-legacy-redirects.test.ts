import { describe, expect, it } from "vitest";
import { legacyProjectHomeRedirectTarget } from "./issues-legacy-redirects";

describe("legacyProjectHomeRedirectTarget", () => {
  it("maps overview lens to tab=overview on the project issue", () => {
    expect(
      legacyProjectHomeRedirectTarget(
        "issue-tracker",
        new URLSearchParams("lens=overview"),
      ),
    ).toBe("/projects/issue-tracker/issues/issue-tracker?tab=overview");
  });

  it("maps structure lens to the project issue without tab", () => {
    expect(
      legacyProjectHomeRedirectTarget(
        "issue-tracker",
        new URLSearchParams("lens=structure"),
      ),
    ).toBe("/projects/issue-tracker/issues/issue-tracker");
  });
});
