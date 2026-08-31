// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  LegacyPipelineRedirect,
  LegacyPipelineRunRedirect,
  LegacyPipelineRunsRedirect,
} from "./pipeline-legacy-redirects";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location-probe">{pathname + search}</div>;
}

function RedirectTarget() {
  return <div data-testid="redirect-target" />;
}

function mountRedirectRoutes(entry: string): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/pipelines" element={<RedirectTarget />} />
          <Route path="/runs" element={<RedirectTarget />} />
          <Route
            path="/runs/:conversationId"
            element={<RedirectTarget />}
          />
          <Route
            path="/pipeline/runs/:conversationId"
            element={<LegacyPipelineRunRedirect />}
          />
          <Route
            path="/pipeline/runs"
            element={<LegacyPipelineRunsRedirect />}
          />
          <Route path="/pipeline" element={<LegacyPipelineRedirect />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("legacy pipeline redirects", () => {
  it("redirects /pipeline to /pipelines preserving search", () => {
    const { container } = mountRedirectRoutes(
      "/pipeline?pipeline=work&step=grill",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?pipeline=work&step=grill");
  });

  it("redirects /pipeline/runs to /runs", () => {
    const { container } = mountRedirectRoutes("/pipeline/runs");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs");
  });

  it("redirects /pipeline/runs/:conversationId to /runs/:conversationId", () => {
    const { container } = mountRedirectRoutes("/pipeline/runs/a%2Fb");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs/a%2Fb");
  });
});
