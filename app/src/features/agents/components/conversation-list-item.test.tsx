import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RosterActiveRunIndicator } from "./conversation-list-item";

describe("RosterActiveRunIndicator", () => {
  it("renders the running marker when activeRun is true", () => {
    const html = renderToStaticMarkup(
      <RosterActiveRunIndicator activeRun={true} />,
    );
    expect(html).toContain('data-testid="roster-active-run"');
    expect(html).toContain('aria-label="Running"');
  });

  it("renders nothing when activeRun is false", () => {
    const html = renderToStaticMarkup(
      <RosterActiveRunIndicator activeRun={false} />,
    );
    expect(html).toBe("");
  });
});
